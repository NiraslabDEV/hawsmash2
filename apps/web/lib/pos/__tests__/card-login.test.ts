import { describe, expect, it } from 'vitest';

import {
  appendPinDigit,
  cardInitials,
  cardState,
  loginErrorMessage,
  lockCountdown,
  roleLabel,
  type StaffCard,
} from '../card-login';

const BASE: StaffCard = {
  user_id: '11111111-1111-4111-8111-111111111111',
  full_name: 'Ridwan Nissar',
  role: 'cashier',
  has_pin: true,
  locked_until: null,
};

const AGORA = Date.parse('2026-09-16T10:00:00Z');

describe('cardInitials', () => {
  it('usa a primeira e a última palavra do nome', () => {
    expect(cardInitials('Ridwan Nissar')).toBe('RN');
    expect(cardInitials('Ana Maria dos Santos')).toBe('AS');
  });

  it('aguenta um nome só, espaços a mais e nome vazio', () => {
    expect(cardInitials('Ridwan')).toBe('RI');
    expect(cardInitials('  ana   maria  ')).toBe('AM');
    expect(cardInitials('   ')).toBe('?');
  });
});

describe('cardState', () => {
  it('quem tem PIN e não está travado pode entrar', () => {
    expect(cardState(BASE, AGORA)).toBe('ready');
  });

  it('sem PIN o card não pede PIN nenhum — pede que o criem', () => {
    expect(cardState({ ...BASE, has_pin: false }, AGORA)).toBe('no-pin');
  });

  it('travado por tentativas falhadas fica travado até a hora passar', () => {
    const travado = { ...BASE, locked_until: '2026-09-16T10:05:00Z' };
    expect(cardState(travado, AGORA)).toBe('locked');
    expect(cardState(travado, Date.parse('2026-09-16T10:05:01Z'))).toBe('ready');
  });

  it('inactivo por falta de PIN manda-se criar PIN mesmo que esteja travado', () => {
    const semPin = { ...BASE, has_pin: false, locked_until: '2026-09-16T10:05:00Z' };
    expect(cardState(semPin, AGORA)).toBe('no-pin');
  });
});

describe('lockCountdown', () => {
  it('conta em minutos acima de um minuto e em segundos abaixo', () => {
    expect(lockCountdown('2026-09-16T10:03:30Z', AGORA)).toBe('4 min');
    expect(lockCountdown('2026-09-16T10:00:45Z', AGORA)).toBe('45 s');
  });

  it('não conta o que já passou', () => {
    expect(lockCountdown('2026-09-16T09:59:00Z', AGORA)).toBeNull();
    expect(lockCountdown(null, AGORA)).toBeNull();
  });
});

describe('loginErrorMessage', () => {
  it('diz o que fazer, não o código do erro', () => {
    expect(loginErrorMessage('invalid_pin')).toContain('PIN');
    expect(loginErrorMessage('pin_not_configured')).toContain('gerente');
    expect(loginErrorMessage('staff_not_in_store')).toContain('loja');
    expect(loginErrorMessage('invalid_device')).toContain('vinculado');
  });

  it('num card travado diz quanto falta esperar', () => {
    expect(loginErrorMessage('pin_locked', '2026-09-16T10:03:30Z', AGORA)).toContain('4 min');
  });

  it('erro desconhecido nunca deixa o ecrã mudo', () => {
    expect(loginErrorMessage('qualquer_coisa').length).toBeGreaterThan(0);
  });
});

describe('appendPinDigit', () => {
  it('acumula até seis algarismos e ignora o resto', () => {
    expect(appendPinDigit('123', '4')).toBe('1234');
    expect(appendPinDigit('123456', '7')).toBe('123456');
  });

  it('não aceita o que não é algarismo', () => {
    expect(appendPinDigit('12', 'a')).toBe('12');
    expect(appendPinDigit('12', '')).toBe('12');
  });
});

describe('roleLabel', () => {
  it('traduz o perfil para o que se diz no balcão', () => {
    expect(roleLabel('cashier')).toBe('Caixa');
    expect(roleLabel('manager')).toBe('Gerente');
    expect(roleLabel('kitchen')).toBe('Cozinha');
    expect(roleLabel('owner')).toBe('Dono');
  });
});
