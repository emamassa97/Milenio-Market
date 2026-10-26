# Milenio Market · Sistema de caja

Sistema de caja para el kiosco Milenio Market: cobro con lector de códigos
(USB o cámara del celular), stock, cierre de caja, reportes y fiado.
Funciona sin internet: todo se guarda en el equipo (IndexedDB).

## Para trabajar

```bash
npm install
npm run dev        # abre el sistema en http://localhost:5173
npm test           # pruebas automáticas
npm run build      # chequeo de tipos + versión para publicar (carpeta dist)
```

`VITE_DEMO=1 npm run build` arma la versión de prueba, que arranca con
productos de ejemplo.

## Cómo está armado

- `src/dominio/`: las cuentas (carrito, vuelto, caja, fiado, precios,
  reportes, planillas). Sin pantallas, con pruebas.
- `src/datos/`: la base del equipo (Dexie) y todo lo que guarda o cambia
  datos. Cada operación que toca más de una tabla va en una transacción.
- `src/pantallas/`: caja, productos, cierre, reportes, clientes, ajustes.
- `src/ui/`: piezas comunes (ventanas, avisos, campo de pesos, íconos, cámara).

Dónde quedó el trabajo y qué sigue: `docs/COMO-SEGUIR.md`.
