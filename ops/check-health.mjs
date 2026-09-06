const controller = new AbortController();
const timer = setTimeout(() => controller.abort(), 3000);
try {
  const response = await fetch("http://127.0.0.1:" + (process.env.PORT || "3000") + "/api/health/ready", {
    signal: controller.signal, redirect: "error",
  });
  process.exitCode = response.status === 200 ? 0 : 1;
} catch { process.exitCode = 1; } finally { clearTimeout(timer); }

