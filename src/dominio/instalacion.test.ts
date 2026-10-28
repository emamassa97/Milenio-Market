import { describe, expect, it } from 'vitest';
import { comoInstalar, detectarNavegador } from './instalacion';

const UA = {
  chrome: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
  edge: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0',
  firefox: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:131.0) Gecko/20100101 Firefox/131.0',
  safariMac: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15',
  android: 'Mozilla/5.0 (Linux; Android 14; SM-A145M) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36',
  iphone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
};

describe('instalar como aplicación', () => {
  it('reconoce el navegador por lo que cambia los pasos', () => {
    expect(detectarNavegador(UA.chrome)).toBe('chrome');
    expect(detectarNavegador(UA.edge)).toBe('edge');
    expect(detectarNavegador(UA.firefox)).toBe('firefox');
    expect(detectarNavegador(UA.safariMac)).toBe('safari-mac');
    expect(detectarNavegador(UA.android)).toBe('android');
    expect(detectarNavegador(UA.iphone)).toBe('iphone');
  });

  it('Firefox no puede: lo manda a Chrome o Edge', () => {
    const f = comoInstalar('firefox');
    expect(f.puede).toBe(false);
    expect(f.pasos[0]).toMatch(/Chrome/);
    expect(f.pasos[0]).toMatch(/Edge/);
  });

  it('cada navegador que puede tiene pasos propios', () => {
    for (const n of ['chrome', 'edge', 'safari-mac', 'android', 'iphone'] as const) {
      const c = comoInstalar(n);
      expect(c.puede).toBe(true);
      expect(c.pasos.length).toBeGreaterThanOrEqual(2);
    }
    expect(comoInstalar('edge').pasos.join(' ')).toMatch(/Aplicaciones/);
  });
});
