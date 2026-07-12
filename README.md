# Treino

App mobile para controlar treino de academia com foco em uso rápido durante a sessão.

## Recursos

- Treinos flexíveis: A, B, C, D ou quantos você quiser criar.
- Registro de séries feitas por exercício.
- Peso usado no treino atual e peso da última sessão.
- Tipos de exercício: normal, bi-set, tri-set, drop-set e unilateral.
- Pesos separados para cada exercício combinado em bi-set/tri-set.
- Timer automático de pausa depois de registrar uma série.
- Lista de exercícios pendentes e concluídos.
- Histórico por treino e resumo por exercício com sugestão de próxima carga.
- Backup opcional no Firebase Firestore.
- Login anônimo, Google ou e-mail/senha via Firebase Authentication.
- Exportação e importação dos dados em JSON.
- Funcionamento offline quando servido por `localhost` ou hospedagem HTTPS.

## Como abrir localmente

O app é estático. Dá para abrir `index.html` diretamente no navegador. Para testar o modo instalável/offline, sirva a pasta por um servidor local:

```bash
python -m http.server 4173
```

Depois acesse `http://localhost:4173`.

## Firebase

O app continua funcionando sem Firebase. Para ativar o backup na nuvem:

1. No Firebase Console, crie ou abra o projeto.
2. Em Authentication > Sign-in method, ative Anonymous.
3. Opcionalmente, ative Google e Email/Password para usar conta fixa.
4. Em Configurações do projeto > Geral, adicione um app Web.
5. Copie o objeto `firebaseConfig`.
6. Copie `firebase-config.local.example.js` para `firebase-config.local.js`.
7. Cole os valores reais em `firebase-config.local.js` e troque `enabled` para `true`.
8. Nao envie `firebase-config.local.js` para o GitHub.
9. Na aba Regras do Cloud Firestore, cole o conteúdo de `firestore.rules` e publique.

Os dados são salvos em:

```text
users/{uid}/apps/treino
```

Cada conta só lê e escreve o próprio documento, conforme as regras em `firestore.rules`.

## Estrutura

```text
index.html
styles.css
app.js
manifest.webmanifest
sw.js
assets/icon.svg
firebase-config.js
firebase-config.local.example.js
firebase-sync.js
firestore.rules
```

`firebase-config.js` fica com valores vazios para ser seguro no GitHub. O arquivo real deve ser `firebase-config.local.js`, que esta no `.gitignore`.
