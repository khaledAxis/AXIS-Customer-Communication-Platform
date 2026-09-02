const ACTION = Object.freeze({
  ALLOW_APPLICATION: "ALLOW_APPLICATION",
  OPEN_EXTERNAL: "OPEN_EXTERNAL",
  REJECT: "REJECT",
});

function parseExpectedOrigin(expectedOrigin) {
  const expected = new URL(expectedOrigin);
  if (
    expected.protocol !== "http:" ||
    expected.hostname !== "127.0.0.1" ||
    expected.username ||
    expected.password ||
    expected.origin !== expectedOrigin
  ) {
    throw new Error("The Electron application origin must be an exact 127.0.0.1 HTTP origin.");
  }
  return expected;
}

function isLocalApplicationHost(hostname) {
  const normalized = hostname.toLowerCase();
  return (
    normalized === "localhost" ||
    normalized.endsWith(".localhost") ||
    normalized === "0.0.0.0" ||
    normalized === "[::]" ||
    normalized === "[::1]" ||
    /^127(?:\.|$)/.test(normalized)
  );
}

function decideNavigation(targetUrl, expectedOrigin) {
  const expected = parseExpectedOrigin(expectedOrigin);
  let target;

  try {
    target = new URL(targetUrl);
  } catch {
    return { action: ACTION.REJECT };
  }

  if (target.username || target.password) return { action: ACTION.REJECT };
  if (target.protocol !== "http:" && target.protocol !== "https:") {
    return { action: ACTION.REJECT };
  }

  if (target.origin === expected.origin) {
    return { action: ACTION.ALLOW_APPLICATION };
  }

  // An unexpected local origin may be another service on the workstation. It is
  // neither allowed in the AXIS window nor delegated to the system browser.
  if (isLocalApplicationHost(target.hostname)) return { action: ACTION.REJECT };

  return { action: ACTION.OPEN_EXTERNAL, url: target.href };
}

module.exports = {
  ACTION,
  decideNavigation,
  isLocalApplicationHost,
  parseExpectedOrigin,
};
