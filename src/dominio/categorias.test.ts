import { describe, expect, it } from 'vitest';
import { sugerirCategoria } from './categorias';

describe('sugerirCategoria', () => {
  const casos: [string, string | null][] = [
    ['Alfajor Jorgito negro', 'Golosinas'],
    ['Chocolate con leche Milka 55g', 'Golosinas'],
    ['Beldent menta', 'Golosinas'],
    ['Lavandina Ayudín 1 l', 'Productos de limpieza'],
    ['Agua lavandina 2L', 'Productos de limpieza'],
    ['Detergente Magistral 500', 'Productos de limpieza'],
    ['Jabón en polvo Ala 800g', 'Productos de limpieza'],
    ['Jabón Dove', 'Higiene personal'],
    ['Papel higiénico Higienol x4', 'Higiene personal'],
    ['Papas fritas Lays 85g', 'Snacks'],
    ['Maní salado', 'Snacks'],
    ['Coca-Cola 500 ml', 'Bebidas'],
    ['Agua Villavicencio 1,5', 'Bebidas'],
    ['Cerveza Quilmes lata 473', 'Bebidas con alcohol'],
    ['Fernet Branca 750', 'Bebidas con alcohol'],
    ['Marlboro box 20', 'Cigarrillos'],
    ['Leche La Serenísima 1 l', 'Lácteos'],
    ['Jamón cocido x 100 g', 'Fiambrería'],
    ['Yerba Playadito 500 g', 'Almacén'],
    ['Galletitas Criollitas', 'Almacén'],
    ['Pilas Duracell AA', 'Varios'],
    ['Salame milán', 'Fiambrería'],
    ['Producto raro XZ', null],
  ];
  it.each(casos)('%s → %s', (nombre, esperada) => {
    expect(sugerirCategoria(nombre, [])).toBe(esperada);
  });

  it('usa la categoría que ya tiene el kiosco aunque esté escrita distinto', () => {
    expect(sugerirCategoria('Alfajor triple', ['golosina', 'Bebidas'])).toBe('golosina');
    expect(sugerirCategoria('Lavandina', ['Limpieza'])).toBe('Limpieza');
    expect(sugerirCategoria('Cerveza Brahma', ['Cervezas', 'Bebidas'])).toBe('Cervezas');
    expect(sugerirCategoria('Leche entera', ['Fiambrería', 'Lácteos'])).toBe('Lácteos');
  });

  it('no confunde pedazos de palabras', () => {
    expect(sugerirCategoria('Salamín', [])).toBe('Fiambrería'); // no "ala"
    expect(sugerirCategoria('Serenito vainilla', [])).toBe('Lácteos');
  });

  it('si el nombre no alcanza, prueba con el proveedor', () => {
    expect(sugerirCategoria('Box 20', [], 'Marlboro')).toBe('Cigarrillos');
  });
});
