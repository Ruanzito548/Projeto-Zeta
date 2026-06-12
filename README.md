## WoW TBC Craft Profit

Sistema de craft/disenchant para WoW com login por usuario usando Firebase Auth.

## Setup

1. Instale as dependencias:

```bash
npm install
```

2. Crie o arquivo `.env.local` com base no `.env.example`.

3. Preencha as variaveis do Firebase:

```bash
NEXT_PUBLIC_FIREBASE_API_KEY=
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=
NEXT_PUBLIC_FIREBASE_PROJECT_ID=
NEXT_PUBLIC_FIREBASE_APP_ID=
```

4. No Firebase Console:
- Crie um projeto.
- Ative Authentication.
- Ative o provider `Google`.

5. Rode o app:

```bash
npm run dev
```

## Usuarios e dados

- Cada usuario faz login somente com Google.
- Os dados do sistema sao separados por usuario (UID), evitando mistura entre contas.
