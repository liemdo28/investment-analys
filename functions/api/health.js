export async function onRequestGet() {
  return new Response(
    JSON.stringify({
      ok: true,
      service: "neon-financial-analyzer",
      now: new Date().toISOString()
    }),
    {
      headers: {
        "content-type": "application/json; charset=utf-8"
      }
    }
  );
}
