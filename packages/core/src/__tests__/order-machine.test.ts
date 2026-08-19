import { describe, it, expect } from 'vitest';
import { transition, type Order, type Actor } from '../order-machine';

const staff: Actor = { role: 'manager' };
const customer: Actor = { role: 'customer' };
const kitchen: Actor = { role: 'kitchen' };

describe('Fluxo digital — transições válidas', () => {
  it('draft → awaiting_payment (SUBMIT_PAYMENT)', () => {
    const order: Order = { flow: 'digital', status: 'draft' };
    expect(transition(order, 'SUBMIT_PAYMENT', customer)).toEqual({ ok: true, newStatus: 'awaiting_payment' });
  });

  it('awaiting_payment → paid (PAYMENT_SUCCESS)', () => {
    const order: Order = { flow: 'digital', status: 'awaiting_payment' };
    expect(transition(order, 'PAYMENT_SUCCESS', customer)).toEqual({ ok: true, newStatus: 'paid' });
  });

  it('awaiting_payment → payment_failed (PAYMENT_FAILED)', () => {
    const order: Order = { flow: 'digital', status: 'awaiting_payment' };
    expect(transition(order, 'PAYMENT_FAILED', customer)).toEqual({ ok: true, newStatus: 'payment_failed' });
  });

  it('payment_failed → awaiting_payment (RETRY_PAYMENT)', () => {
    const order: Order = { flow: 'digital', status: 'payment_failed' };
    expect(transition(order, 'RETRY_PAYMENT', customer)).toEqual({ ok: true, newStatus: 'awaiting_payment' });
  });

  it('paid → in_preparation (START_PREPARATION)', () => {
    const order: Order = { flow: 'digital', status: 'paid' };
    expect(transition(order, 'START_PREPARATION', kitchen)).toEqual({ ok: true, newStatus: 'in_preparation' });
  });

  it('in_preparation → ready (MARK_READY)', () => {
    const order: Order = { flow: 'digital', status: 'in_preparation' };
    expect(transition(order, 'MARK_READY', kitchen)).toEqual({ ok: true, newStatus: 'ready' });
  });

  it('ready → delivered (DELIVER)', () => {
    const order: Order = { flow: 'digital', status: 'ready' };
    expect(transition(order, 'DELIVER', staff)).toEqual({ ok: true, newStatus: 'delivered' });
  });
});

describe('Fluxo manual — transições válidas', () => {
  it('draft → awaiting_approval (SUBMIT)', () => {
    const order: Order = { flow: 'manual', status: 'draft' };
    expect(transition(order, 'SUBMIT', customer)).toEqual({ ok: true, newStatus: 'awaiting_approval' });
  });

  it('awaiting_approval → approved (APPROVE)', () => {
    const order: Order = { flow: 'manual', status: 'awaiting_approval' };
    expect(transition(order, 'APPROVE', staff)).toEqual({ ok: true, newStatus: 'approved' });
  });

  it('approved → in_preparation (START_PREPARATION)', () => {
    const order: Order = { flow: 'manual', status: 'approved' };
    expect(transition(order, 'START_PREPARATION', kitchen)).toEqual({ ok: true, newStatus: 'in_preparation' });
  });

  it('in_preparation → ready (MARK_READY)', () => {
    const order: Order = { flow: 'manual', status: 'in_preparation' };
    expect(transition(order, 'MARK_READY', kitchen)).toEqual({ ok: true, newStatus: 'ready' });
  });

  it('ready → delivered (DELIVER)', () => {
    const order: Order = { flow: 'manual', status: 'ready' };
    expect(transition(order, 'DELIVER', staff)).toEqual({ ok: true, newStatus: 'delivered' });
  });
});

describe('Cancelamento', () => {
  it('staff pode cancelar pedido em draft', () => {
    const order: Order = { flow: 'digital', status: 'draft' };
    expect(transition(order, 'CANCEL', staff)).toEqual({ ok: true, newStatus: 'cancelled' });
  });

  it('staff pode cancelar pedido em paid', () => {
    const order: Order = { flow: 'digital', status: 'paid' };
    expect(transition(order, 'CANCEL', staff)).toEqual({ ok: true, newStatus: 'cancelled' });
  });

  it('kitchen pode cancelar', () => {
    const order: Order = { flow: 'manual', status: 'in_preparation' };
    expect(transition(order, 'CANCEL', kitchen)).toEqual({ ok: true, newStatus: 'cancelled' });
  });

  it('customer NÃO pode cancelar — UNAUTHORIZED', () => {
    const order: Order = { flow: 'digital', status: 'draft' };
    const result = transition(order, 'CANCEL', customer);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.reason).toBe('UNAUTHORIZED');
  });
});

describe('Estados terminais', () => {
  it('não transita a partir de delivered', () => {
    const order: Order = { flow: 'digital', status: 'delivered' };
    const result = transition(order, 'START_PREPARATION', staff);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.reason).toBe('TERMINAL_STATE');
  });

  it('não cancela a partir de cancelled', () => {
    const order: Order = { flow: 'manual', status: 'cancelled' };
    const result = transition(order, 'CANCEL', staff);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.reason).toBe('TERMINAL_STATE');
  });
});

describe('Transições inválidas — INVALID_EVENT', () => {
  it('draft → in_preparation pula etapas (digital)', () => {
    const order: Order = { flow: 'digital', status: 'draft' };
    const result = transition(order, 'START_PREPARATION', staff);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.reason).toBe('INVALID_EVENT');
      expect(result.error.from).toBe('draft');
    }
  });

  it('manual usa evento digital SUBMIT_PAYMENT', () => {
    const order: Order = { flow: 'manual', status: 'draft' };
    const result = transition(order, 'SUBMIT_PAYMENT', customer);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.reason).toBe('INVALID_EVENT');
  });

  it('digital usa evento manual SUBMIT', () => {
    const order: Order = { flow: 'digital', status: 'draft' };
    const result = transition(order, 'SUBMIT', customer);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.reason).toBe('INVALID_EVENT');
  });
});

describe('error shape — InvalidTransition', () => {
  it('contém type, reason, from e event', () => {
    const order: Order = { flow: 'digital', status: 'draft' };
    const result = transition(order, 'DELIVER', customer);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.type).toBe('INVALID_TRANSITION');
      expect(result.error.from).toBe('draft');
      expect(result.error.event).toBe('DELIVER');
    }
  });
});
