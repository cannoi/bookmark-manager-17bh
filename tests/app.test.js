const assert = require('assert');
const http = require('http');

const PORT = process.env.PORT || 8080;

async function runTests() {
  console.log('Running tests...');
  try {
    const res = await new Promise((resolve, reject) => {
      http.get(`http://localhost:${PORT}/health`, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => resolve({ statusCode: res.statusCode, data }));
      }).on('error', reject);
    });

    assert.strictEqual(res.statusCode, 200);
    console.log('Health check passed!');
    process.exit(0);
  } catch (err) {
    console.error('Test failed:', err);
    process.exit(1);
  }
}

// Wait a moment for server to start if required
setTimeout(runTests, 1000);
