/** Dependency-free so pure modules (and Jest) can count syllables without loading the model runtime. */
export function countSyllables(text: string): number {
  const words = text.toLowerCase().match(/[a-z']+/g) ?? [];
  let total = 0;

  for (const word of words) {
    // Vowel groups approximate syllables.
    const groups = word.match(/[aeiouy]+/g);
    let n = groups ? groups.length : 1;

    // Silent terminal 'e' ("make" is one syllable, not two).
    if (word.length > 2 && word.endsWith('e') && !/[aeiouy]e$/.test(word)) {
      n = Math.max(1, n - 1);
    }
    total += Math.max(1, n);
  }
  return total;
}
