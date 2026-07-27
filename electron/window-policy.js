export function resolvePetWindowPolicy(platform) {
  return {
    focusable: platform !== 'linux',
  };
}
