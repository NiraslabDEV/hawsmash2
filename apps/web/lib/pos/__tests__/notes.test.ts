import { describe, expect, it } from 'vitest';
import { noteHasChip, toggleNoteChip } from '../notes';

describe('atalhos de nota somam-se', () => {
  it('numa nota vazia, o atalho passa a ser a nota', () => {
    expect(toggleNoteChip('', 'SEM CEBOLA')).toBe('SEM CEBOLA');
  });

  it('um segundo atalho junta-se ao primeiro em vez de o apagar', () => {
    const nota = toggleNoteChip(toggleNoteChip('', 'SEM CEBOLA'), 'SEM MOLHO');
    expect(nota).toBe('SEM CEBOLA, SEM MOLHO');
  });

  it('o que foi escrito à mão fica', () => {
    expect(toggleNoteChip('tocar à campainha', 'PARA LEVAR')).toBe(
      'tocar à campainha, PARA LEVAR',
    );
  });

  it('tocar outra vez no mesmo atalho tira-o, sem mexer nos outros', () => {
    expect(toggleNoteChip('SEM CEBOLA, SEM MOLHO', 'SEM CEBOLA')).toBe('SEM MOLHO');
    expect(toggleNoteChip('sem cebola', 'SEM CEBOLA')).toBe('');
  });

  it('sabe dizer que atalhos já estão escolhidos', () => {
    expect(noteHasChip('SEM CEBOLA, SEM MOLHO', 'SEM MOLHO')).toBe(true);
    expect(noteHasChip('SEM CEBOLA', 'SEM MOLHO')).toBe(false);
  });
});
