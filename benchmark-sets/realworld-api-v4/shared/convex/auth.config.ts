export default {
  providers: [{ type: "customJwt", applicationID: "convex", issuer: process.env.CONVEX_AUTH_ISSUER ?? "http://127.0.0.1:3210", jwks: process.env.CONVEX_AUTH_JWKS ?? "data:application/json;base64,e30=", algorithm: "RS256" }],
};
