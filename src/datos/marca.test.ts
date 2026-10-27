import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it, vi } from 'vitest';

// Simula recargar la página con el reloj de la PC atrasado: las marcas `_v`
// ya guardadas son "del futuro" y los cambios nuevos igual tienen que subir.

afterEach(() => {
  vi.useRealTimers();
});

const producto = (nombre: string) => ({
  codigo: '', nombre, precio: 1, costo: 0, stock: 0, stockMinimo: 0, categoria: '', rapido: false, creado: 0, actualizado: 0,
});

async function cargarModulos() {
  vi.resetModules();
  const { BaseKiosco } = await import('./db');
  const nube = await import('./nube');
  return { BaseKiosco, ...nube };
}

describe('marca de sincronización', () => {
  it('no retrocede aunque el reloj se atrase y se recargue la página', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2030-01-01T12:00:00Z'));
    const nombre = 'marca-reloj';
    const antes = await cargarModulos();
    const db1 = new antes.BaseKiosco(nombre);
    await db1.open();
    await db1.productos.add(producto('Alfajor'));
    await antes.subirCambios(db1, async () => {});
    expect(await antes.pendientes(db1)).toBe(0);
    db1.close();

    // "Recarga": módulos nuevos (el contador en memoria arranca de cero) y el reloj, un año atrás.
    vi.setSystemTime(new Date('2029-01-01T12:00:00Z'));
    const despues = await cargarModulos();
    const db2 = new despues.BaseKiosco(nombre);
    await db2.open();
    await db2.productos.add(producto('Chicle'));
    expect(await despues.pendientes(db2)).toBe(1);
    const subidos: string[] = [];
    await despues.subirCambios(db2, async (l) => {
      for (const r of l.registros) if (r.tabla === 'productos') subidos.push((r.datos as { nombre: string }).nombre);
    });
    expect(subidos).toEqual(['Chicle']);
    await db2.delete();
  });

  it('tampoco retrocede si lo más nuevo ya subido se borró', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2030-01-01T12:00:00Z'));
    const nombre = 'marca-borrado';
    const antes = await cargarModulos();
    const db1 = new antes.BaseKiosco(nombre);
    await db1.open();
    const id = await db1.productos.add(producto('Viejo'));
    await antes.subirCambios(db1, async () => {});
    await db1.productos.delete(id);
    db1.close();

    vi.setSystemTime(new Date('2029-01-01T12:00:00Z'));
    const despues = await cargarModulos();
    const db2 = new despues.BaseKiosco(nombre);
    await db2.open();
    await db2.productos.add(producto('Nuevo'));
    expect(await despues.pendientes(db2)).toBe(1);
    await db2.delete();
  });
});
