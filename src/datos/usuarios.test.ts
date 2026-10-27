import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { BaseKiosco } from './db';
import { borrarUsuario, cambiarClave, crearUsuario, ingresar, leerUsuarios } from './usuarios';

let db: BaseKiosco;
let n = 0;
beforeEach(async () => {
  db = new BaseKiosco(`usuarios-${n++}`);
  await db.open();
});
afterEach(async () => {
  await db.delete();
});

describe('usuarios', () => {
  it('entra con la clave correcta y no guarda la clave', async () => {
    await crearUsuario(db, { usuario: 'Ema', nombre: 'Emanuel', clave: '1234', admin: true });
    expect((await ingresar(db, 'ema', '1234'))?.nombre).toBe('Emanuel');
    expect(await ingresar(db, 'ema', '9999')).toBeNull();
    expect(await ingresar(db, 'otro', '1234')).toBeNull();
    expect(JSON.stringify(await leerUsuarios(db))).not.toContain('1234');
  });
  it('valida usuario, clave y duplicados', async () => {
    await expect(crearUsuario(db, { usuario: 'con espacio', nombre: '', clave: '1234', admin: true })).rejects.toThrow();
    await expect(crearUsuario(db, { usuario: 'ana', nombre: '', clave: '12', admin: true })).rejects.toThrow();
    await crearUsuario(db, { usuario: 'ana', nombre: '', clave: '1234', admin: true });
    await expect(crearUsuario(db, { usuario: 'ANA', nombre: '', clave: '1234', admin: false })).rejects.toThrow();
  });
  it('cambia la clave y no deja borrar el último administrador', async () => {
    await crearUsuario(db, { usuario: 'ema', nombre: '', clave: '1234', admin: true });
    await crearUsuario(db, { usuario: 'caja', nombre: '', clave: '1111', admin: false });
    await cambiarClave(db, 'ema', 'nueva');
    expect(await ingresar(db, 'ema', '1234')).toBeNull();
    expect(await ingresar(db, 'ema', 'nueva')).not.toBeNull();
    await expect(borrarUsuario(db, 'ema')).rejects.toThrow();
    await borrarUsuario(db, 'caja');
    expect(await leerUsuarios(db)).toHaveLength(1);
  });
});
