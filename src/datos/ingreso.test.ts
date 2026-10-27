import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BaseKiosco } from './db';
import { ingresarDondeSea } from './ingreso';
import { guardarAjuste, leerAjuste } from './operaciones';
import { crearUsuario, leerUsuarios } from './usuarios';

let db: BaseKiosco;
let n = 0;
beforeEach(async () => {
  db = new BaseKiosco(`ingreso-${n++}`);
  await db.open();
});
afterEach(async () => {
  vi.unstubAllGlobals();
  await db.delete();
});

const respuesta = (cuerpo: unknown, estado = 200) => new Response(JSON.stringify(cuerpo), { status: estado, headers: { 'content-type': 'application/json' } });

/** Arma la lista de usuarios de "otro equipo" con la clave hasheada de verdad. */
async function usuariosDeOtroEquipo() {
  const otro = new BaseKiosco(`otro-${n++}`);
  await otro.open();
  await crearUsuario(otro, { usuario: 'ema', nombre: 'Emanuel', clave: '4826', admin: true });
  const lista = await leerUsuarios(otro);
  await otro.delete();
  return lista;
}

describe('un usuario para todos los equipos', () => {
  it('en un equipo nuevo entra con el usuario de la nube y se trae los datos', async () => {
    const usuarios = await usuariosDeOtroEquipo();
    vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
      if (new Headers(init?.headers).get('x-ingreso') === '1') return respuesta({ clave: 'CLAVE', usuarios, dispositivo: 'pc' });
      if (String(url).includes('desde=')) {
        return respuesta({
          dispositivo: 'pc',
          registros: [
            { tabla: 'productos', id: 'p1', datos: { id: 'p1', nombre: 'Alfajor', precio: 900, _v: 5 } },
            { tabla: 'ajustes', id: 'usuarios', datos: { clave: 'usuarios', valor: usuarios, _v: 6 } },
          ],
          siguiente: null,
        });
      }
      return respuesta({}, 404);
    });
    const u = await ingresarDondeSea(db, 'EMA', '4826');
    expect(u.usuario).toBe('ema');
    expect(await db.productos.count()).toBe(1);
    expect(await leerAjuste(db, 'nube.clave', '')).toBe('CLAVE');
  });

  it('sin internet entra con lo guardado en el equipo', async () => {
    await crearUsuario(db, { usuario: 'ema', nombre: '', clave: '4826', admin: true });
    vi.stubGlobal('fetch', async () => {
      throw new TypeError('sin red');
    });
    expect((await ingresarDondeSea(db, 'ema', '4826')).usuario).toBe('ema');
    await expect(ingresarDondeSea(db, 'ema', 'otra')).rejects.toThrow(/incorrectos/);
  });

  it('en un equipo unido a la nube, una clave vieja ya no sirve', async () => {
    await crearUsuario(db, { usuario: 'ema', nombre: '', clave: '4826', admin: true });
    await guardarAjuste(db, 'nube.clave', 'CLAVE');
    await guardarAjuste(db, 'nube.marcas', { ajustes: Number.MAX_SAFE_INTEGER });
    vi.stubGlobal('fetch', async () => respuesta({ error: 'Usuario o clave incorrectos.' }, 401));
    await expect(ingresarDondeSea(db, 'ema', '4826')).rejects.toThrow(/incorrectos/);
  });

  it('la clave cambiada en otro equipo llega a éste', async () => {
    await crearUsuario(db, { usuario: 'ema', nombre: '', clave: '1357', admin: true });
    await guardarAjuste(db, 'nube.clave', 'CLAVE');
    await guardarAjuste(db, 'nube.marcas', { ajustes: Number.MAX_SAFE_INTEGER });
    const usuarios = await usuariosDeOtroEquipo();
    vi.stubGlobal('fetch', async () => respuesta({ clave: 'CLAVE', usuarios, dispositivo: 'pc' }));
    await ingresarDondeSea(db, 'ema', '4826');
    expect((await leerUsuarios(db))[0]!.hash).toBe(usuarios[0]!.hash);
  });

  it('un equipo con ventas propias no se pisa con la nube', async () => {
    const usuarios = await usuariosDeOtroEquipo();
    await db.productos.add({ id: 'mio', nombre: 'Mío' } as never);
    vi.stubGlobal('fetch', async () => respuesta({ clave: 'CLAVE', usuarios, dispositivo: 'pc' }));
    await expect(ingresarDondeSea(db, 'ema', '4826')).rejects.toThrow(/ventas propias/);
  });

  it('con el usuario bloqueado por intentos, el equipo de siempre sigue entrando', async () => {
    await crearUsuario(db, { usuario: 'ema', nombre: '', clave: '4826', admin: true });
    await guardarAjuste(db, 'nube.clave', 'CLAVE');
    vi.stubGlobal('fetch', async () => respuesta({ error: 'Demasiadas claves mal seguidas' }, 429));
    expect((await ingresarDondeSea(db, 'ema', '4826')).usuario).toBe('ema');
    await expect(ingresarDondeSea(db, 'ema', 'otra')).rejects.toThrow(/Demasiadas/);
  });
});
