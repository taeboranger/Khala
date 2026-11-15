export default {
  agentRules: false,
  devIndicators: false,
  async redirects() {
    return [{ source: '/', destination: '/chat', permanent: false }]
  },
  serverExternalPackages: ['@electric-sql/pglite', 'pg', 'pdfjs-dist', '@napi-rs/canvas'],
}
