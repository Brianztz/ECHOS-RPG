# ECHOS RPG

Ficha de personagem + Escudo do Mestre de **Ordem Paranormal RPG v1.3**, com sincronização em tempo real.

A versão de produção foi preparada para **Cloudflare Workers + Durable Objects + WebSockets**. O servidor Node.js antigo continua no repositório apenas como fallback local.

## Estrutura

```text
public/
  index.html
  jogador/index.html
  mestre/index.html
  shared/
    player-live.js
    gm-live.js
    live.css
  socket.io/socket.io.js   # camada compatível sobre WebSocket nativo
src/
  worker.mjs               # Worker + Durable Object da mesa
wrangler.jsonc
server.js                  # fallback Node.js local
```

## Como a conexão funciona

Cada código de **MESA** corresponde a um Durable Object. Todas as fichas e o Escudo que usam o mesmo código entram na mesma sala.

O botão **Copiar link da ficha** produz um endereço como:

```text
https://SEU-DOMINIO/jogador?mesa=CODIGO-DA-MESA
```

Ao abrir esse link, a ficha já entra na mesa correta. Cada ficha mantém também um código próprio de 4 caracteres para que o servidor reconheça o mesmo personagem após reconexões.

A interface continua usando os mesmos eventos criados durante o desenvolvimento (`master_ready`, `status_change`, `players_snapshot`, `update_mestre`, `player_disconnected`, `sync_requested` etc.). Em produção, `/socket.io/socket.io.js` fornece uma camada compatível sobre WebSocket nativo, então não foi necessário reescrever a ficha grande inteira.

## O que funciona em tempo real

- jogadores aparecem e desaparecem automaticamente no Escudo;
- nome, retrato, NEX, Defesa, PV, SAN, PE e Radiação;
- condições da ficha;
- alterações de PV/SAN/PE/Radiação feitas pelo mestre;
- mensagem privada do mestre;
- envio de equipamentos;
- armas enviadas entram na ficha e também aguardam encaixe na maleta;
- envio de rituais e poderes pelo compêndio;
- envio de pistas diretamente para a ficha;
- reconexão automática do WebSocket;
- persistência do estado da ficha por mesa;
- fila curta para eventos do mestre quando uma ficha estiver temporariamente offline.

## Persistência no Cloudflare

O estado de cada mesa fica no armazenamento SQLite do seu Durable Object. Como a ficha é grande e pode conter imagens em base64, o JSON completo é dividido internamente em blocos menores antes de ser salvo. O retrato também é armazenado separadamente do índice dos jogadores.

O Escudo continua salvando seus dados de interface/local de campanha no `localStorage` como antes; a parte compartilhada entre mestre e jogadores fica no Durable Object.

## Cloudflare — deploy pelo GitHub

O repositório contém `wrangler.jsonc`, então o caminho recomendado é conectar um **Cloudflare Worker com Builds** ao repositório GitHub `Brianztz/ECHOS-RPG`.

Configuração:

```text
Branch de produção: main
Build command: pode ficar vazio
Deploy command: npx wrangler deploy
Root directory: /
```

Depois disso, cada push/merge em `main` dispara um novo deploy automaticamente.

O Worker serve tanto os arquivos estáticos quanto o backend WebSocket. As rotas principais são:

```text
/                 página inicial
/mestre           Escudo do Mestre
/jogador          ficha do jogador
/api/health       teste do Worker
/ws               WebSocket interno
```

## Desenvolvimento local com Cloudflare

Com Node.js instalado:

```bash
npm install
npm run dev
```

O Wrangler inicia o mesmo Worker localmente, incluindo Durable Objects e os arquivos de `public/`.

Para conferir a configuração antes de publicar:

```bash
npm run check
```

Para publicar manualmente:

```bash
npm run deploy
```

## Fallback Node.js antigo

O `server.js` foi mantido para não perder o servidor que já funcionava localmente. Para usá-lo:

```bash
npm install
npm run start:node
```

Esse modo usa Express + Socket.IO + `node:sqlite`. Ele é apenas fallback; o deploy Cloudflare usa `src/worker.mjs`.

## Escudo do Mestre

A primeira aba mostra somente os jogadores conectados. As abas visíveis atualmente são:

- Mesa
- Investigação
- Equipamentos
- Rituais & Poderes
- Pistas
- Referência

As antigas abas Combate, Testes, Horror e Condições continuam ocultas e não fazem parte da navegação atual.

## Próximas alterações

A partir desta estrutura, mudanças de ficha, Escudo, pistas e conexão podem ser feitas diretamente no código do repositório. Não é mais necessário gerar e substituir ZIPs para cada alteração.
