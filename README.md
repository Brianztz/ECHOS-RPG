# Ordem Paranormal Online — Ficha + Escudo do Mestre

Sistema Node.js que conecta a ficha do jogador ao Escudo do Mestre em tempo real.

## O que já está funcionando

- criação de campanha pelo mestre;
- código de sala de 7 caracteres;
- token privado do mestre e token individual de cada jogador;
- reconexão automática após fechar/reabrir a página;
- jogadores online/offline no Escudo;
- sincronização automática da ficha completa;
- PV, SAN, PE, Radiação e condições visíveis no Escudo;
- o mestre pode alterar PV, SAN, PE, Radiação e condições remotamente;
- mensagens do mestre para o jogador;
- envio de equipamentos diretamente para a ficha;
- armas enviadas também entram na lista de armas da ficha e na maleta aguardando encaixe;
- envio de rituais diretamente pelo Compêndio do Escudo;
- envio de poderes/habilidades diretamente pelo Compêndio;
- envio das pistas do quadro do mestre diretamente para a aba Pistas do jogador;
- banco SQLite para guardar campanhas, jogadores, estado das fichas e eventos;
- Socket.IO para atualização em tempo real.

## Requisitos

- Node.js 20 ou superior.
- npm.

## Instalação

Abra um terminal dentro desta pasta e rode:

```bash
npm install
npm start
```

Depois abra:

- Início: `http://localhost:3000`
- Mestre: `http://localhost:3000/mestre`
- Jogador: `http://localhost:3000/jogador`

No Windows, você também pode executar `iniciar.bat`.

## Jogando na mesma rede Wi‑Fi/LAN

O servidor escuta em `0.0.0.0`, então outros computadores e celulares da mesma rede podem acessar.

1. Descubra o IP do computador do mestre. No Windows, rode `ipconfig` e procure o IPv4, por exemplo `192.168.0.10`.
2. No computador do mestre: `http://localhost:3000/mestre`.
3. Nos dispositivos dos jogadores: `http://192.168.0.10:3000/jogador`.
4. Se o Windows perguntar sobre Firewall, permita o Node.js em redes privadas.

## Fluxo da campanha

1. O mestre abre `/mestre` e cria uma Campanha Online.
2. O Escudo mostra um código, como `AUR7K2Q`.
3. Cada jogador abre `/jogador`, coloca o código, seu nome e personagem.
4. A ficha começa a sincronizar automaticamente.
5. O Escudo exibe os jogadores online e seus recursos.

## Enviar equipamento

Na aba **Equipamentos** do Escudo:

1. abra/crie um equipamento;
2. no final do popup, escolha um jogador conectado;
3. clique em **Enviar ao jogador**.

Na ficha, o equipamento entra na maleta em **Itens aguardando encaixe**. Se for arma, também é adicionada ao catálogo de armas da ficha.

## Enviar ritual ou poder

Na aba **Rituais & Poderes**:

1. abra uma entrada do compêndio;
2. escolha um jogador conectado;
3. clique em **Enviar ritual** ou **Enviar poder**.

A ficha procura o nome no catálogo interno e adiciona a entrada.

## Enviar pistas

Na aba **Pistas** do Escudo:

1. crie pistas e defina a audiência normalmente;
2. escolha um jogador em **Enviar pistas diretamente para um jogador conectado**;
3. clique em **Enviar pistas liberadas**.

A ficha recebe o pacote sem precisar importar JSON manualmente.

## Banco de dados

O arquivo é criado automaticamente em:

```text
data/ordem.sqlite
```

Tabelas principais:

- `campaigns`
- `players`
- `player_states`
- `events`

Para fazer backup da campanha, copie o arquivo `ordem.sqlite` com o servidor desligado.

## Segurança atual

O código da campanha serve para localizar a sala, mas não funciona como permissão administrativa. O mestre recebe um token aleatório separado e cada jogador recebe seu próprio token. Comandos de mestre são validados no servidor antes de serem enviados às fichas.

Este projeto foi pensado primeiro para uso local/LAN. Para publicar na internet, use HTTPS, proxy reverso e regras adicionais de autenticação/rate limit.


## Se aparecer “localhost recusou a conexão”

Isso significa que o navegador abriu, mas o servidor Node.js ainda não está rodando.

A versão corrigida do `iniciar.bat` primeiro inicia o servidor, espera `/api/health`
responder e **só então abre o navegador**.

Se ainda der erro:

1. Não feche a janela `Ordem Online - Servidor`.
2. Execute `diagnosticar.bat`.
3. Se houver erro na janela do servidor, copie a mensagem completa.
4. O endereço local recomendado é `http://127.0.0.1:3000`.



## Correção para Node.js 24

Esta versão não usa mais `better-sqlite3`, que precisava compilar um módulo nativo e estava falhando no Node.js 24 quando não havia Python/Build Tools instalados.

Agora o projeto usa o módulo `node:sqlite` que já vem no próprio Node.js. Portanto, em Node.js 24 não é necessário instalar Python, Visual Studio Build Tools ou compilar SQLite.

Se você tentou a versão anterior e ficou uma pasta `node_modules` incompleta, não há problema: o novo `iniciar.bat` executa `npm install` novamente e ajusta as dependências.


## Primeira aba do mestre
A primeira aba agora mostra somente os jogadores conectados automaticamente, no padrão visual do Escudo do Mestre do Outro Lado: retrato, personagem, jogador, NEX, Defesa, PV, SAN, PE, Radiação, condições e botão de gerenciamento.


## Conexão automática por sala

A conexão agora segue o mesmo fluxo simples usado no outro projeto:

1. Abra `/mestre`.
2. O Escudo cria ou recupera automaticamente uma mesa.
3. Use **COPIAR LINK DA FICHA**.
4. O link terá este formato: `/jogador?sala=CODIGO`.
5. Quando o jogador abre o link, a ficha lê `?sala=...`, salva a sala e entra automaticamente.
6. Nome do jogador e personagem são lidos diretamente da própria ficha.
7. Alterações da ficha são enviadas automaticamente ao Escudo.
8. Ao atualizar o navegador, Escudo e ficha recuperam a mesma conexão.
9. O botão **SINCRONIZAR** do mestre pede imediatamente o estado de todas as fichas online.

O servidor continua usando tokens internamente para evitar que um jogador assuma outra ficha, mas o jogador não precisa digitar ou conhecer esses tokens.


## Conexão refeita no padrão de mestre.html / ficha.html

- Mestre e jogador usam um código de **MESA**, com `PADRAO` como padrão.
- O Mestre anuncia a mesa com `master_ready` e recebe `players_snapshot`.
- Cada ficha tem um código próprio persistente de 4 caracteres.
- A ficha envia seus dados com `status_change` sempre que salva/sincroniza.
- O Escudo recebe as mudanças com `update_mestre`.
- Ao fechar/desconectar uma ficha, o Escudo recebe `player_disconnected`.
- O Mestre pode forçar um `sync_requested`.
- Alterações do Mestre podem retornar à ficha por `player_data_updated`.
- O link da ficha é `/jogador?mesa=CODIGO`.

O SQLite foi mantido apenas como persistência. A conexão visível não exige cadastro, login ou token.
