# Keycloak-Notizen

- Ein Realm-Import (`--import-realm`) greift nur, wenn der Realm noch nicht existiert. Änderungen an der
  JSON-Datei wirken erst nach dem Neuanlegen der Keycloak-Datenbank.
- Nutzer-IDs im Realm-Export fest eintragen, sonst bekommen die Seed-Nutzer bei jedem Import neue `sub`s und
  verlieren ihre Daten in den Apps.
- Token Exchange (Standard, RFC 8693) braucht beim anfragenden Client `standard.token.exchange.enabled` und
  eine Audience, die der Ziel-Client akzeptiert.
- Öffentliche Clients immer mit PKCE S256; Direct Access Grants (Passwort-Grant) ausschalten.
- Immer `localhost` statt `127.0.0.1` verwenden: Cookies und Redirect-URIs hängen am Hostnamen.
