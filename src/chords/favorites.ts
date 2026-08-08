interface FavoriteChord { id: string; name: string; category?: string }

export function resolveFavoriteIds(favorites: string[], chords: FavoriteChord[]): string[] {
  return [...new Set(favorites.flatMap((favorite) => {
    if (chords.some((chord) => chord.id === favorite)) return [favorite];
    const matches = chords.filter((chord) => chord.name === favorite);
    const preferred = matches.find((chord) => chord.category === "Essential Open") ?? matches[0];
    return preferred ? [preferred.id] : [];
  }))];
}
