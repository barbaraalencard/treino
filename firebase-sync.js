const FIREBASE_SDK_VERSION = "12.16.0";
const FIREBASE_BASE_URL = `https://www.gstatic.com/firebasejs/${FIREBASE_SDK_VERSION}`;
const DEFAULT_DOCUMENT_PATH = null;

export async function createFirebaseSync({
  config,
  appName = "treino-ab",
  documentPath = DEFAULT_DOCUMENT_PATH,
  getLocalState,
  getLocalUpdatedAtMs,
  onRemoteState,
  onSaved,
  onStatus
}) {
  const [{ initializeApp, getApps, getApp }, authSdk, firestoreSdk] = await Promise.all([
    import(`${FIREBASE_BASE_URL}/firebase-app.js`),
    import(`${FIREBASE_BASE_URL}/firebase-auth.js`),
    import(`${FIREBASE_BASE_URL}/firebase-firestore.js`)
  ]);

  const app = getApps().some((item) => item.name === appName)
    ? getApp(appName)
    : initializeApp(config, appName);
  const auth = authSdk.getAuth(app);
  const db = firestoreSdk.getFirestore(app);
  let uid = null;
  let userRef = null;
  let stateRef = null;
  let saveTimer = null;
  let saving = false;

  function getAuthMeta() {
    const user = auth.currentUser;
    const provider = user?.isAnonymous
      ? "anonymous"
      : user?.providerData?.[0]?.providerId || "firebase";

    return {
      uid,
      email: user?.email || "",
      isAnonymous: Boolean(user?.isAnonymous),
      provider,
      path: uid ? (documentPath || `users/${uid}/apps/treino`) : ""
    };
  }

  function refreshRefs() {
    const user = auth.currentUser;
    uid = user?.uid || null;
    if (!uid) return;
    userRef = firestoreSdk.doc(db, "users", uid);
    stateRef = documentPath
      ? firestoreSdk.doc(db, ...documentPath.split("/").filter(Boolean))
      : firestoreSdk.doc(db, "users", uid, "apps", "treino");
  }

  function setStatus(state, label, detail = "") {
    onStatus?.({ state, label, detail, ...getAuthMeta() });
  }

  async function setLocalPersistence() {
    if (!authSdk.setPersistence || !authSdk.browserLocalPersistence) return;
    try {
      await authSdk.setPersistence(auth, authSdk.browserLocalPersistence);
    } catch {
      // Some embedded/private browsers can block local persistence. Firebase will keep its fallback.
    }
  }

  async function waitForInitialAuthState() {
    setStatus("connecting", "Recuperando sessão", "Conferindo se já existe uma conta Google salva neste navegador.");

    if (typeof auth.authStateReady === "function") {
      await auth.authStateReady();
      refreshRefs();
      return auth.currentUser;
    }

    return new Promise((resolve) => {
      const unsubscribe = authSdk.onAuthStateChanged(
        auth,
        (user) => {
          unsubscribe();
          refreshRefs();
          resolve(user);
        },
        () => {
          unsubscribe();
          refreshRefs();
          resolve(auth.currentUser);
        }
      );
    });
  }

  async function ensureSignedIn() {
    if (auth.currentUser) {
      refreshRefs();
      return auth.currentUser;
    }

    setStatus("connecting", "Entrando no Firebase", "Criando uma sessao segura para este aparelho.");
    const credential = await authSdk.signInAnonymously(auth);
    refreshRefs();
    setStatus("ok", "Firebase conectado", "Backup anonimo ativo. Voce pode vincular uma conta quando quiser.");
    return credential.user;
  }

  await setLocalPersistence();
  await waitForInitialAuthState();
  await ensureSignedIn();

  authSdk.onAuthStateChanged(auth, (user) => {
    if (!user) return;
    refreshRefs();
    setStatus("ok", user.isAnonymous ? "Firebase conectado" : "Conta conectada", user.isAnonymous
      ? "Backup anonimo ativo neste aparelho."
      : "Backup vinculado a sua conta.");
  });

  async function readRemote() {
    await ensureSignedIn();
    const snapshot = await firestoreSdk.getDoc(stateRef);
    if (!snapshot.exists()) return null;
    const data = snapshot.data();
    if (!data?.state) return null;
    return {
      state: data.state,
      updatedAtMs: Number(data.updatedAtMs) || 0
    };
  }

  async function pullRemote(options = {}) {
    setStatus("syncing", "Baixando da nuvem", "Comparando seus dados locais com o Firestore.");
    const remote = await readRemote();
    if (!remote) {
      setStatus("ok", "Firebase conectado", "Ainda nao existe backup na nuvem. Vou criar no proximo envio.");
      return { applied: false, empty: true };
    }

    const localUpdatedAtMs = Number(getLocalUpdatedAtMs?.()) || 0;
    if (options.force || remote.updatedAtMs > localUpdatedAtMs) {
      onRemoteState?.(remote.state, remote.updatedAtMs);
      setStatus("ok", "Nuvem aplicada", "Este aparelho recebeu a versao mais recente do Firestore.");
      return { applied: true, remote };
    }

    setStatus("ok", "Firebase conectado", "Os dados deste aparelho ja estao iguais ou mais novos.");
    return { applied: false, remote };
  }

  async function pushLocal(localState = getLocalState(), updatedAtMs = Date.now()) {
    await ensureSignedIn();
    if (saving) return;
    saving = true;
    setStatus("syncing", "Enviando para a nuvem", "Salvando seu treino no Firestore.");

    try {
      const payload = {
        app: "treino-ab",
        schemaVersion: 2,
        state: localState,
        uid,
        account: getAuthMeta(),
        updatedAtMs,
        updatedAt: firestoreSdk.serverTimestamp()
      };

      if (documentPath) {
        await firestoreSdk.setDoc(stateRef, payload, { merge: true });
      } else {
        const batch = firestoreSdk.writeBatch(db);
        batch.set(
          userRef,
          {
            uid,
            app: "treino-ab",
            account: getAuthMeta(),
            updatedAtMs,
            updatedAt: firestoreSdk.serverTimestamp()
          },
          { merge: true }
        );
        batch.set(stateRef, payload, { merge: true });
        await batch.commit();
      }

      onSaved?.(updatedAtMs);
      setStatus("ok", "Sincronizado", `Backup salvo em ${getAuthMeta().path}.`);
    } finally {
      saving = false;
    }
  }

  function queueSave(localState = getLocalState(), updatedAtMs = Date.now()) {
    window.clearTimeout(saveTimer);
    saveTimer = window.setTimeout(() => {
      pushLocal(localState, updatedAtMs).catch((error) => {
        setStatus("error", "Erro ao sincronizar", error?.message || "Nao foi possivel salvar no Firestore.");
      });
    }, 900);
  }

  async function syncNow() {
    try {
      const result = await pullRemote();
      if (!result.applied) {
        await pushLocal(getLocalState(), Number(getLocalUpdatedAtMs?.()) || Date.now());
      }
    } catch (error) {
      setStatus("error", "Erro ao sincronizar", error?.message || "Nao foi possivel falar com o Firebase.");
      throw error;
    }
  }

  async function signInWithGoogle() {
    const provider = new authSdk.GoogleAuthProvider();
    setStatus("syncing", "Abrindo login Google", "Finalize o acesso na janela do Google.");

    try {
      if (auth.currentUser?.isAnonymous) {
        try {
          await authSdk.linkWithPopup(auth.currentUser, provider);
        } catch (error) {
          if (!["auth/credential-already-in-use", "auth/email-already-in-use", "auth/provider-already-linked"].includes(error?.code)) {
            throw error;
          }
          await authSdk.signInWithPopup(auth, provider);
        }
      } else {
        await authSdk.signInWithPopup(auth, provider);
      }

      refreshRefs();
      setStatus("ok", "Conta Google conectada", "Seu backup agora fica vinculado a esta conta.");
      await syncNow();
      return getAuthMeta();
    } catch (error) {
      setStatus("error", "Login Google falhou", error?.message || "Nao foi possivel conectar com Google.");
      throw error;
    }
  }

  async function signInWithEmail(email, password) {
    setStatus("syncing", "Entrando por e-mail", "Conferindo sua conta no Firebase.");
    try {
      await authSdk.signInWithEmailAndPassword(auth, email, password);
      refreshRefs();
      setStatus("ok", "Conta conectada", "Backup vinculado ao seu e-mail.");
      await syncNow();
      return getAuthMeta();
    } catch (error) {
      setStatus("error", "Login por e-mail falhou", error?.message || "Nao foi possivel entrar.");
      throw error;
    }
  }

  async function createAccountWithEmail(email, password) {
    setStatus("syncing", "Criando conta", "Vinculando seu treino ao e-mail informado.");

    try {
      if (auth.currentUser?.isAnonymous) {
        const credential = authSdk.EmailAuthProvider.credential(email, password);
        await authSdk.linkWithCredential(auth.currentUser, credential);
      } else {
        await authSdk.createUserWithEmailAndPassword(auth, email, password);
      }

      refreshRefs();
      setStatus("ok", "Conta criada", "Seu backup agora fica vinculado ao seu e-mail.");
      await pushLocal(getLocalState(), Number(getLocalUpdatedAtMs?.()) || Date.now());
      return getAuthMeta();
    } catch (error) {
      setStatus("error", "Nao consegui criar a conta", error?.message || "Confira e-mail e senha.");
      throw error;
    }
  }

  async function signOutUser() {
    setStatus("syncing", "Saindo da conta", "Voltando para um backup anonimo neste aparelho.");
    await authSdk.signOut(auth);
    await ensureSignedIn();
    await syncNow();
    return getAuthMeta();
  }

  return {
    get uid() {
      return uid;
    },
    getAuthMeta,
    pullRemote,
    pushLocal,
    queueSave,
    syncNow,
    signInWithGoogle,
    signInWithEmail,
    createAccountWithEmail,
    signOutUser
  };
}
