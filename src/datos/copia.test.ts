import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { exportarTodo, restaurarCopia } from './copia';
import { BaseKiosco, TABLAS_NUBE } from './db';
import { AJUSTES_LOCALES } from './nube';
import { guardarAjuste, guardarProducto, leerAjuste } from './operaciones';

let db: BaseKiosco;
let n = 0;
beforeEach(async () => {
  db = new BaseKiosco(`copia-${n++}`);
  await db.open();
});
afterEach(async () => {
  await db.delete();
});

const SECRETOS: [string, unknown][] = [
  ['nube.clave', 'super-secreta'],
  ['nube.marcas', { productos: 9 }],
  ['nube.borrado', 3],
  ['nube.ultima', 123],
  ['nube.error', 'falló'],
  ['nube.estado', 'sin-activar'],
  ['dispositivo', 'equipo-1'],
];

describe('copia de seguridad', () => {
  it('exporta todas las tablas pero no los ajustes de la nube ni el equipo', async () => {
    for (const [clave, valor] of SECRETOS) await guardarAjuste(db, clave, valor);
    await guardarAjuste(db, 'cajero', 'Ema');
    await guardarProducto(db, { codigo: '', nombre: 'A', precio: 1, costo: 0, stock: 0, stockMinimo: 0, categoria: '', rapido: false });
    const copia = await exportarTodo(db);
    expect(Object.keys(copia.tablas)).toEqual([...TABLAS_NUBE]);
    expect(copia.tablas.productos).toHaveLength(1);
    expect((copia.tablas.ajustes as { clave: string }[]).map((a) => a.clave)).toEqual(['cajero']);
    expect(JSON.stringify(copia)).not.toContain('super-secreta');
    for (const [clave] of SECRETOS) expect(AJUSTES_LOCALES.has(clave)).toBe(true);
  });

  it('una copia vieja con la clave de otro equipo no la pisa al restaurar', async () => {
    const vieja = {
      app: 'milenio-market',
      formato: 1,
      fecha: '',
      tablas: { ajustes: [{ clave: 'nube.clave', valor: 'de-otro' }, { clave: 'dispositivo', valor: 'otro' }, { clave: 'cajero', valor: 'Ana' }] },
    };
    await restaurarCopia(db, vieja);
    expect(await leerAjuste(db, 'nube.clave', '')).toBe('');
    expect(await leerAjuste(db, 'dispositivo', '')).toBe('');
    expect(await leerAjuste(db, 'cajero', '')).toBe('Ana');
  });
});
