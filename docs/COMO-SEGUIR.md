# Cómo funciona la nube

La caja funciona siempre con los datos guardados en el equipo (sin internet también).
Cuando hay internet, cada equipo (la PC del mostrador, el celular, otra compu) se
sincroniza con la nube cada 30 segundos: sube lo suyo y baja lo de los demás. Todos
ven los mismos productos, ventas, clientes y la misma caja.

## Una sola vez, en Vercel

1. En el proyecto **milenio-market** → **Storage** → **Create Database** → **Neon**,
   y conectarla al proyecto. Eso crea la variable `DATABASE_URL` (o `POSTGRES_URL`).
2. Nada más. La primera caja que abre la app publicada recibe la clave de la nube y queda
   emparejada; después nadie más puede pedir una. Opcional: `SYNC_CLAVE` en Vercel fija una
   clave a mano y desactiva el alta automática.

Diagnóstico sin secretos: `/api/sincronizar?estado=1` dice si hay base, si conecta, si ya
está activada y cuántos equipos y usuarios hay.

## Usuarios

Hay una sola lista de usuarios para todos los equipos y la controla la nube. En un equipo
nuevo se entra con el mismo usuario y clave: el equipo se trae todo solo. El empleado recibe
un permiso propio (no la clave de la nube) y el servidor no lo deja borrar ni cambiar precios,
ventas ya hechas, clientes o el fondo de la caja.

## Una sola caja

El local tiene una sola caja: se abre, se vende y se cierra desde cualquier equipo.
- Antes de cerrar, el equipo se sincroniza para contar lo último que vendieron los demás.
- Si otro equipo estaba sin internet y vendió en una caja que ya se cerró, esa venta
  "llega tarde" y se cuenta en la caja siguiente (el cierre lo avisa). Ninguna venta queda
  afuera de un cierre ni se cuenta dos veces.
- Si dos equipos abren a la vez sin verse, la que queda vacía se cierra sola y no aparece
  en "Cierres anteriores".

## Qué se guarda en Neon

La tabla `filas(tabla, id, datos jsonb, borrado, seq, tx, equipo)`: una fila por producto,
venta, caja, movimiento, cliente o ajuste, compartida por todos los equipos. Cada equipo
tiene su propio rango de números (equipo 2: ventas "2-1", "2-2"…), así no chocan. El stock
viaja como diferencia (vendí 2, entraron 12), así dos equipos vendiendo a la vez no se pisan.
Los detalles técnicos están en `servidor/sincronizar.ts` y `src/datos/nube.ts`; las pruebas
corren el servidor real sobre Postgres en memoria (`src/datos/nubeFalsa.ts`).
