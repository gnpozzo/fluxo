export const typography = Object.freeze({
  family: 'Inter, system-ui, -apple-system, "Segoe UI", sans-serif',
  body: 14, caption: 12, title: 16, metric: 28
});
export const chartFont = Object.freeze({ family: typography.family, size: typography.caption });

// Inline template fonts no longer compete with the semantic CSS scale.
export function normalizeTypography(root) {
  const nodes = [...(root.matches?.('[style]') ? [root] : []), ...root.querySelectorAll('[style]')];
  for (const node of nodes) {
    if (node.closest('.tc-card-pill, .bank-card')) continue;
    node.style.removeProperty('font-family'); node.style.removeProperty('font-size');
  }
}
