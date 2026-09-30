#!/bin/sh
set -eu

PASSWORD_HASH=$(printf '%s' "${DASHBOARD_PASSWORD}" | openssl sha1 -binary | openssl base64)
DASHBOARD_BASIC_AUTH="${DASHBOARD_USERNAME}:{SHA}${PASSWORD_HASH}"
raw=/tmp/lds.http.yaml

sed -e "s|\${ANON_KEY}|${ANON_KEY}|g" \
    -e "s|\${ANON_KEY_ASYMMETRIC}|${ANON_KEY_ASYMMETRIC}|g" \
    -e "s|\${SERVICE_ROLE_KEY}|${SERVICE_ROLE_KEY}|g" \
    -e "s|\${SERVICE_ROLE_KEY_ASYMMETRIC}|${SERVICE_ROLE_KEY_ASYMMETRIC}|g" \
    -e "s|\${SUPABASE_PUBLISHABLE_KEY}|${SUPABASE_PUBLISHABLE_KEY}|g" \
    -e "s|\${SUPABASE_SECRET_KEY}|${SUPABASE_SECRET_KEY}|g" \
    -e "s|\${DASHBOARD_BASIC_AUTH}|${DASHBOARD_BASIC_AUTH}|g" \
    /etc/envoy/lds.template.yaml > "$raw"

{
  printf '%s\n' 'version_info: "1"'
  cat "$raw"
  sed -e '1{/^resources:/d;}' \
    -e '/^    name: supabase$/s/supabase/supabase_tls/' \
    -e '/^        port_value: 8000$/s/8000/8443/' \
    -e '/^    filter_chains:/i\
    listener_filters:\
      - name: envoy.filters.listener.tls_inspector\
        typed_config:\
          "@type": type.googleapis.com/envoy.extensions.filters.listener.tls_inspector.v3.TlsInspector' \
    -e '/^      - filters:/c\
      - filter_chain_match:\
          transport_protocol: tls\
        transport_socket:\
          name: envoy.transport_sockets.tls\
          typed_config:\
            "@type": type.googleapis.com/envoy.extensions.transport_sockets.tls.v3.DownstreamTlsContext\
            common_tls_context:\
              tls_certificates:\
                - certificate_chain:\
                    filename: /etc/envoy/tls/server.crt\
                  private_key:\
                    filename: /etc/envoy/tls/server.key\
        filters:' \
    "$raw"
} > /etc/envoy/lds.yaml
rm -f "$raw"

exec envoy -c /etc/envoy/envoy.yaml "$@"
