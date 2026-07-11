# Treino A/B

Primeira versão de um app mobile para controlar treino de academia com:

- Treino A e Treino B editáveis.
- Registro de séries feitas por exercício.
- Peso usado no treino atual e peso da última sessão.
- Timer automático de pausa depois de registrar uma série.
- Lista de exercícios pendentes.
- Histórico local salvo no próprio navegador.
- Exportação e importação dos dados em JSON.
- Funcionamento offline quando servido por `localhost` ou hospedagem HTTPS.

## Como abrir localmente

O app é estático. Dá para abrir `index.html` diretamente no navegador. Para testar o modo instalável/offline, sirva a pasta por um servidor local:

```bash
python -m http.server 4173
```

Depois acesse `http://localhost:4173`.

## Estrutura

```text
index.html
styles.css
app.js
manifest.webmanifest
sw.js
assets/icon.svg
```
