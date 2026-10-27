import 'fake-indexeddb/auto';
import { liveQuery } from 'dexie';
import { expect, it } from 'vitest';
import { BaseKiosco, fijarRango } from './db';
import { abrirTurno, turnoAbierto } from './operaciones';
// La pantalla de la caja se entera sola de la caja abierta (un await ajeno dentro del liveQuery la dejaba ciega).
it('liveQuery ve la caja nueva', async () => {
  const db = new BaseKiosco('live-1'); await db.open();
  await fijarRango(db, 1);
  const vistos: unknown[] = [];
  const sub = liveQuery(() => turnoAbierto(db)).subscribe({ next: (t) => vistos.push(t?.id ?? null), error: (e) => vistos.push('ERR ' + e) });
  await new Promise((r) => setTimeout(r, 100));
  await abrirTurno(db, 'x', 0);
  await new Promise((r) => setTimeout(r, 300));
  sub.unsubscribe();
  expect(vistos).toEqual([null, 1000000001]);
});
