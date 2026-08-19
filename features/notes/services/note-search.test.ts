import { toFtsQuery } from '@/features/notes/services/note-search';

/**
 * The query builder is the part worth testing without a database: it is the
 * boundary where arbitrary typed text becomes FTS5 syntax, and FTS5 throws on
 * syntax it does not like.
 */
describe('toFtsQuery', () => {
  it('makes every token a prefix so search is incremental', () => {
    // "ren" has to find "renovation" while it is still being typed.
    expect(toFtsQuery('ren')).toBe('"ren"*');
  });

  it('requires every token', () => {
    expect(toFtsQuery('kitchen renovation')).toBe('"kitchen"* AND "renovation"*');
  });

  it('lowercases', () => {
    expect(toFtsQuery('Kitchen')).toBe('"kitchen"*');
  });

  it('has no query for empty input', () => {
    expect(toFtsQuery('')).toBeNull();
    expect(toFtsQuery('   ')).toBeNull();
  });

  describe('input that would otherwise be a syntax error', () => {
    // Every one of these throws inside FTS5 if passed through raw, and every one
    // is something a person types into a search field without thinking.
    it('strips a stray quote', () => {
      expect(toFtsQuery("it's")).toBe('"it"* AND "s"*');
    });

    it('strips FTS operators rather than honouring them', () => {
      // Nobody searching a notes app is trying to write a NEAR query, and
      // treating it as one turns a typo into an error.
      expect(toFtsQuery('a NEAR b')).toBe('"a"* AND "near"* AND "b"*');
    });

    it('strips a bare asterisk', () => {
      expect(toFtsQuery('*')).toBeNull();
    });

    it('strips unbalanced parentheses', () => {
      expect(toFtsQuery('(kitchen')).toBe('"kitchen"*');
    });

    it('strips punctuation entirely', () => {
      expect(toFtsQuery('rent: £500 — due!')).toBe('"rent"* AND "500"* AND "due"*');
    });

    it('has no query for punctuation alone', () => {
      expect(toFtsQuery('!!! ???')).toBeNull();
    });
  });

  describe('non-Latin input', () => {
    // The app ships in Arabic, Hindi and Urdu. A tokenizer split on [a-z0-9]
    // would reduce every one of those searches to nothing.
    it('keeps Arabic tokens', () => {
      expect(toFtsQuery('ملاحظة')).toBe('"ملاحظة"*');
    });

    it('keeps Devanagari tokens', () => {
      expect(toFtsQuery('रसोई नवीनीकरण')).toBe('"रसोई"* AND "नवीनीकरण"*');
    });

    it('keeps digits in any script', () => {
      expect(toFtsQuery('note 42')).toBe('"note"* AND "42"*');
    });
  });
});
