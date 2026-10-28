import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { BaseKiosco } from './db';
import { guardarAjuste, leerAjuste } from './operaciones';
import { borrarUsuario, cambiarClave, crearUsuario, empezarDeCero, ingresar, leerUsuarios, resumenEquipo, revalidarSesion } from './usuarios';

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
  it('empezar de cero borra usuarios y datos, y desconecta el equipo de la nube', async () => {
    await crearUsuario(db, { usuario: 'ema', nombre: '', clave: '4826', admin: true });
    await guardarAjuste(db, 'nube.clave', 'ABC-123');
    await guardarAjuste(db, 'nube.marcas', { productos: 5 });
    await db.clientes.add({ id: 'c1', nombre: 'Ana' } as never);
    expect((await resumenEquipo(db)).clientes).toBe(1);
    await empezarDeCero(db);
    expect(await leerUsuarios(db)).toEqual([]);
    expect(await resumenEquipo(db)).toEqual({ productos: 0, ventas: 0, clientes: 0, sinSubir: 0 });
    // Si quedara la clave de la nube, cualquiera con la compu a mano se hacía dueño en todos los equipos.
    expect(await leerAjuste(db, 'nube.clave', '')).toBe('');
    expect(await leerAjuste(db, 'nube.marcas', null)).toBeNull();
  });

  it('entra con la clave correcta y no guarda la clave', async () => {
    await crearUsuario(db, { usuario: 'Ema', nombre: 'Emanuel', clave: '4826', admin: true });
    expect((await ingresar(db, 'ema', '4826'))?.nombre).toBe('Emanuel');
    expect(await ingresar(db, 'ema', '9999')).toBeNull();
    expect(await ingresar(db, 'otro', '4826')).toBeNull();
    expect(JSON.stringify(await leerUsuarios(db))).not.toContain('4826');
  });
  it('valida usuario, clave y duplicados', async () => {
    await expect(crearUsuario(db, { usuario: 'con espacio', nombre: '', clave: '4826', admin: true })).rejects.toThrow();
    await expect(crearUsuario(db, { usuario: 'ana', nombre: '', clave: '12', admin: true })).rejects.toThrow(/al menos 4/);
    await crearUsuario(db, { usuario: 'ana', nombre: '', clave: '4826', admin: true });
    await expect(crearUsuario(db, { usuario: 'ANA', nombre: '', clave: '4826', admin: false })).rejects.toThrow(/Ya existe/);
  });
  it('rechaza claves obvias con un mensaje claro', async () => {
    for (const clave of ['1234', '0000', '1111', '4321', '2345', '9876', '123456', 'aaaa']) {
      await expect(crearUsuario(db, { usuario: 'ana', nombre: '', clave, admin: true })).rejects.toThrow(/muy fácil de adivinar/);
    }
    for (const clave of ['1357', '4826', '1123', 'hola']) {
      await expect(crearUsuario(db, { usuario: `u${clave}`, nombre: '', clave, admin: true })).resolves.toBeTruthy();
    }
    await expect(cambiarClave(db, 'u4826', '0000')).rejects.toThrow(/muy fácil de adivinar/);
  });
  it('cambia la clave y no deja borrar el último administrador', async () => {
    await crearUsuario(db, { usuario: 'ema', nombre: '', clave: '4826', admin: true });
    await crearUsuario(db, { usuario: 'caja', nombre: '', clave: '7391', admin: false });
    await cambiarClave(db, 'ema', 'nueva');
    expect(await ingresar(db, 'ema', '4826')).toBeNull();
    expect(await ingresar(db, 'ema', 'nueva')).not.toBeNull();
    await expect(cambiarClave(db, 'nadie', 'otra-clave')).rejects.toThrow(/ya no existe/);
    await expect(borrarUsuario(db, 'ema')).rejects.toThrow();
    await borrarUsuario(db, 'caja');
    expect(await leerUsuarios(db)).toHaveLength(1);
  });
  it('crear dos a la vez no pierde ninguno (transacción)', async () => {
    await Promise.all([
      crearUsuario(db, { usuario: 'uno', nombre: '', clave: '4826', admin: true }),
      crearUsuario(db, { usuario: 'dos', nombre: '', clave: '7391', admin: false }),
    ]);
    expect((await leerUsuarios(db)).map((u) => u.usuario).sort()).toEqual(['dos', 'uno']);
  });
  it('revalida la sesión: datos al día o null si lo borraron', async () => {
    await crearUsuario(db, { usuario: 'ema', nombre: 'Emanuel', clave: '4826', admin: true });
    await crearUsuario(db, { usuario: 'caja', nombre: 'Caja', clave: '7391', admin: false });
    expect(await revalidarSesion(db, 'ema')).toEqual({ usuario: 'ema', nombre: 'Emanuel', admin: true });
    expect(await revalidarSesion(db, { usuario: 'caja' })).toEqual({ usuario: 'caja', nombre: 'Caja', admin: false });
    await borrarUsuario(db, 'caja');
    expect(await revalidarSesion(db, 'caja')).toBeNull();
  });
});
