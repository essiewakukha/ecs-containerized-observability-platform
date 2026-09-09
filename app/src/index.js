const express = require('express');
const client = require('prom-client');

const app = express();
const PORT = process.env.PORT || 3000;

// ---- Prometheus metrics setup ----
const register = new client.Registry();
client.collectDefaultMetrics({ register });

const httpRequestDuration = new client.Histogram({
  name: 'http_request_duration_seconds',
  help: 'Duration of HTTP requests in seconds',
  labelNames: ['method', 'route', 'status_code'],
  buckets: [0.05, 0.1, 0.3, 0.5, 1, 2, 5],
});
register.registerMetric(httpRequestDuration);

const httpRequestsTotal = new client.Counter({
  name: 'http_requests_total',
  help: 'Total number of HTTP requests',
  labelNames: ['method', 'route', 'status_code'],
});
register.registerMetric(httpRequestsTotal);

app.use((req, res, next) => {
  const end = httpRequestDuration.startTimer();
  res.on('finish', () => {
    const route = req.route ? req.route.path : req.path;
    const labels = { method: req.method, route, status_code: res.statusCode };
    end(labels);
    httpRequestsTotal.inc(labels);
  });
  next();
});

// ---- Application routes ----
app.get('/', (req, res) => {
  res.json({ service: 'observability-platform-app', status: 'ok' });
});

app.get('/health', (req, res) => {
  res.status(200).json({ status: 'healthy' });
});

// Deliberately flaky endpoint — useful for demoing the 5xx alert rule
app.get('/simulate/error', (req, res) => {
  res.status(500).json({ error: 'Simulated internal server error' });
});

// Deliberately slow endpoint — useful for demoing latency dashboards
app.get('/simulate/slow', async (req, res) => {
  await new Promise((resolve) => setTimeout(resolve, 1500));
  res.json({ status: 'slow response complete' });
});

app.get('/metrics', async (req, res) => {
  res.set('Content-Type', register.contentType);
  res.end(await register.metrics());
});

app.listen(PORT, () => {
  console.log(`App listening on port ${PORT}`);
});

module.exports = app;