
let appPromise;

export default async function handler(req, res) {
  try {
    if (!appPromise) {
      appPromise = import('../backend/src/server.js').then(
        (module) => module.default
      );
    }

    const app = await appPromise;
    return app(req, res);
  } catch (error) {
    console.error('API initialization failed:', error);
    return res.status(500).json({
      ok: false,
      error: 'API initialization failed'
    });
  }
}
