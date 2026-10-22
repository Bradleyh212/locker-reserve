// Development-only preload; never changes API/Stripe/device requests.
const originalFetch = globalThis.fetch;
globalThis.fetch = function (input, init = {}) {
  const url =
    typeof input === "string"
      ? input
      : input instanceof URL
        ? input.href
        : input.url;
  if (url !== "https://registry.npmjs.org/-/package/next/dist-tags") {
    return originalFetch.call(this, input, init);
  }
  const deadline = AbortSignal.timeout(3000);
  const existing =
    init.signal || (typeof input === "object" ? input.signal : undefined);
  return originalFetch.call(this, input, {
    ...init,
    signal: existing ? AbortSignal.any([existing, deadline]) : deadline,
  });
};
