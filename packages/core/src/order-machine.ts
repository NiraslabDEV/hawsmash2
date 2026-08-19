export type OrderFlow = 'digital' | 'manual';

export type OrderStatus =
  | 'draft'
  | 'awaiting_payment'   // digital
  | 'payment_failed'     // digital
  | 'paid'               // digital
  | 'awaiting_approval'  // manual
  | 'approved'           // manual
  | 'in_preparation'
  | 'ready'
  | 'delivered'
  | 'cancelled';

export type OrderEvent =
  | 'SUBMIT_PAYMENT'    // digital: draft → awaiting_payment
  | 'PAYMENT_SUCCESS'   // digital: awaiting_payment → paid
  | 'PAYMENT_FAILED'    // digital: awaiting_payment → payment_failed
  | 'RETRY_PAYMENT'     // digital: payment_failed → awaiting_payment
  | 'SUBMIT'            // manual:  draft → awaiting_approval
  | 'APPROVE'           // manual:  awaiting_approval → approved
  | 'START_PREPARATION' // both:    paid/approved → in_preparation
  | 'MARK_READY'        // both:    in_preparation → ready
  | 'DELIVER'           // both:    ready → delivered
  | 'CANCEL';           // both:    any non-terminal → cancelled (só staff, com motivo, logado em event_log)

export type ActorRole = 'owner' | 'manager' | 'kitchen' | 'bar' | 'waiter' | 'customer';

export type Order = {
  flow: OrderFlow;
  status: OrderStatus;
};

export type Actor = {
  role: ActorRole;
};

export type InvalidTransition = {
  type: 'INVALID_TRANSITION';
  reason: 'INVALID_EVENT' | 'UNAUTHORIZED' | 'TERMINAL_STATE';
  from: OrderStatus;
  event: OrderEvent;
};

export type TransitionResult =
  | { ok: true; newStatus: OrderStatus }
  | { ok: false; error: InvalidTransition };

// ──────────────────────────────────────────────

const TERMINAL: ReadonlySet<OrderStatus> = new Set(['delivered', 'cancelled']);
const STAFF: ReadonlySet<ActorRole> = new Set(['owner', 'manager', 'kitchen', 'bar', 'waiter']);

type TransitionMap = Partial<Record<OrderStatus, Partial<Record<OrderEvent, OrderStatus>>>>;

const DIGITAL: TransitionMap = {
  draft:              { SUBMIT_PAYMENT: 'awaiting_payment' },
  awaiting_payment:   { PAYMENT_SUCCESS: 'paid', PAYMENT_FAILED: 'payment_failed' },
  payment_failed:     { RETRY_PAYMENT: 'awaiting_payment' },
  paid:               { START_PREPARATION: 'in_preparation' },
  in_preparation:     { MARK_READY: 'ready' },
  ready:              { DELIVER: 'delivered' },
};

const MANUAL: TransitionMap = {
  draft:              { SUBMIT: 'awaiting_approval' },
  awaiting_approval:  { APPROVE: 'approved' },
  approved:           { START_PREPARATION: 'in_preparation' },
  in_preparation:     { MARK_READY: 'ready' },
  ready:              { DELIVER: 'delivered' },
};

export function transition(order: Order, event: OrderEvent, actor: Actor): TransitionResult {
  const err = (reason: InvalidTransition['reason']): TransitionResult => ({
    ok: false,
    error: { type: 'INVALID_TRANSITION', reason, from: order.status, event },
  });

  if (TERMINAL.has(order.status)) return err('TERMINAL_STATE');

  if (event === 'CANCEL') {
    if (!STAFF.has(actor.role)) return err('UNAUTHORIZED');
    return { ok: true, newStatus: 'cancelled' };
  }

  const map = order.flow === 'digital' ? DIGITAL : MANUAL;
  const next = map[order.status]?.[event];

  if (!next) return err('INVALID_EVENT');
  return { ok: true, newStatus: next };
}
