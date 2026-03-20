
Zion Games - Servidor v16.0
===========================

Conteúdo:
- server.js (principal)
- package.json

Como usar:
1. Instalar dependências:
   npm install

2. Rodar o servidor:
   npm start

Endpoints de teste:
- GET /api/games/steam?page=1&perPage=20
- GET /api/games/epic
- GET /api/games/descobrir
- GET /api/games/promocoes

Notas:
- Steam: suporta paginação via query params (page, perPage). Cada página corresponde à página de resultados da Steam Search.
- Descrições e preços tentam ser obtidos em português (pt-BR) via API `appdetails` quando disponível.
- Thumbs da Steam usam a imagem oficial `capsule_616x353.jpg`.
