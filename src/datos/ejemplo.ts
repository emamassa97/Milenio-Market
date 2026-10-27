import type { BaseKiosco } from './db';
import { estaVacia } from './copia';
import { ErrorKiosco, guardarAjuste, leerAjuste } from './operaciones';

// [código, nombre, precio, costo, stock, mínimo, categoría, rápido]
const PRODUCTOS: [string, string, number, number, number, number, string, boolean][] = [
  ['1000000000011', 'Coca-Cola 500 ml', 1400, 950, 24, 6, 'Bebidas', true],
  ['1000000000028', 'Coca-Cola 1,5 l', 2600, 1800, 12, 4, 'Bebidas', false],
  ['1000000000035', 'Agua 500 ml', 900, 520, 30, 8, 'Bebidas', true],
  ['1000000000042', 'Sprite 500 ml', 1400, 950, 10, 6, 'Bebidas', false],
  ['1000000000059', 'Speed 250 ml', 1500, 1000, 4, 6, 'Bebidas', false],
  ['1000000000066', 'Cerveza lata 473 ml', 1800, 1250, 36, 12, 'Bebidas', true],
  ['1000000000073', 'Alfajor simple', 650, 400, 4, 10, 'Golosinas', true],
  ['1000000000080', 'Alfajor triple', 1100, 720, 18, 6, 'Golosinas', false],
  ['1000000000097', 'Chicles', 500, 280, 40, 10, 'Golosinas', true],
  ['1000000000103', 'Chocolate 25 g', 900, 560, 22, 6, 'Golosinas', false],
  ['1000000000110', 'Caramelos x 10', 300, 150, 60, 20, 'Golosinas', false],
  ['1000000000127', 'Turrón', 450, 260, 2, 8, 'Golosinas', false],
  ['1000000000134', 'Papas fritas 80 g', 1900, 1250, 15, 5, 'Snacks', true],
  ['1000000000141', 'Maní salado 100 g', 1200, 760, 9, 4, 'Snacks', false],
  ['1000000000158', 'Galletitas dulces', 1300, 850, 14, 5, 'Almacén', false],
  ['1000000000165', 'Galletitas de agua', 1100, 700, 11, 5, 'Almacén', false],
  ['1000000000172', 'Yerba 500 g', 3200, 2300, 8, 4, 'Almacén', false],
  ['1000000000189', 'Pan lactal', 2800, 1950, 3, 3, 'Almacén', false],
  ['1000000000196', 'Leche 1 l', 1500, 1100, 12, 6, 'Lácteos', true],
  ['1000000000202', 'Cigarrillos box 20', 3500, 3000, 30, 10, 'Cigarrillos', true],
  ['1000000000219', 'Encendedor', 900, 450, 25, 5, 'Varios', false],
  ['1000000000226', 'Pañuelitos', 600, 330, 20, 5, 'Varios', false],
];

export async function cargarEjemplo(db: BaseKiosco): Promise<void> {
  const ahora = Date.now();
  await db.transaction('rw', db.tables, async () => {
    if (!(await estaVacia(db))) return;
    await db.productos.bulkAdd(
      PRODUCTOS.map(([codigo, nombre, precio, costo, stock, stockMinimo, categoria, rapido]) => ({
        codigo, nombre, precio, costo, stock, stockMinimo, categoria, rapido, creado: ahora, actualizado: ahora,
      })),
    );
    // Un ejemplo de cada cosa: promo, venta por peso y vencimientos.
    const enDias = (d: number) => new Date(ahora + d * 86_400_000).toISOString().slice(0, 10);
    await db.productos.where('nombre').equals('Alfajor simple').modify({ promo: { cantidad: 3, precio: 1700 } });
    await db.productos.where('nombre').equals('Leche 1 l').modify({ vence: enDias(4) });
    await db.productos.where('nombre').equals('Pan lactal').modify({ vence: enDias(9) });
    await db.productos.add({
      codigo: '', nombre: 'Queso de máquina', precio: 12000, costo: 8200, stock: 3.5, stockMinimo: 1, categoria: 'Fiambrería',
      rapido: true, porPeso: true, creado: ahora, actualizado: ahora,
    });
    await db.clientes.bulkAdd([
      { nombre: 'Marta (3° B)', telefono: '', limite: 20000, creado: ahora },
      { nombre: 'Juan del taller', telefono: '', limite: 0, creado: ahora },
    ]);
    await guardarAjuste(db, 'modoPrueba', true);
  });
}

/**
 * Borra todo. Sólo se permite mientras el equipo está en modo prueba
 * (con datos de ejemplo y sin ninguna caja cerrada).
 */
export async function borrarTodo(db: BaseKiosco): Promise<void> {
  await db.transaction('rw', db.tables, async () => {
    const enPrueba = await leerAjuste(db, 'modoPrueba', false);
    const cierres = await db.turnos.filter((t) => t.cierre !== null).count();
    if (!enPrueba || cierres > 0) throw new ErrorKiosco('Ya hay cajas cerradas: no se puede borrar todo.');
    // Se conservan los usuarios, el id de este equipo y la nube: sólo se borran los datos de prueba.
    const guardar = (await db.ajustes.toArray()).filter((x) => x.clave === 'usuarios' || x.clave === 'dispositivo' || x.clave.startsWith('nube.'));
    for (const t of db.tables) await t.clear();
    if (guardar.length) await db.ajustes.bulkPut(guardar);
  });
}
