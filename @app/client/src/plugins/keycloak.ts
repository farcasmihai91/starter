import Keycloak, { KeycloakConfig, KeycloakPromise } from "keycloak-js";
import { ref } from "vue";

// implementation
const config = {
  clientId: "starter-client",
  url: "https://keycloak.local.starter.com/",
  realm: "starter",
} as KeycloakConfig;

const $keycloak: Keycloak = new Keycloak(config);
let ready = ref(false);
let pendingPromise = ref<KeycloakPromise<unknown, unknown> | null>(null);
let isAuthenticated = ref(false);
let token = ref<string | undefined>();
let authError = ref();

const initKeycloak = () => {
  if (pendingPromise.value) return pendingPromise.value;
  const promise = $keycloak
    .init({
      onLoad: "check-sso",
    })
    .finally(() => {
      pendingPromise.value = null;
    });
  pendingPromise.value = promise;
  return promise;
};

export async function initializeKeycloak(): Promise<void> {
  if (ready.value) {
    return;
  }
  try {
    const _isAuthenticated = await initKeycloak();
    ready.value = true;
    isAuthenticated.value = !!_isAuthenticated;
    token.value = $keycloak.token;

    $keycloak.onAuthRefreshSuccess = () => {
      token.value = $keycloak.token;
    };
    $keycloak.onTokenExpired = () => updateToken();
    $keycloak.onAuthLogout = () => {
      isAuthenticated.value = false;
    };

    $keycloak.onAuthSuccess = () => {
      console.log("on auth sccees");
      isAuthenticated.value = true;
      console.log($keycloak.token);
      console.log($keycloak.idToken);
      console.log($keycloak.refreshToken);
      setInterval(
        () =>
          $keycloak.updateToken(60).catch(() => {
            $keycloak.clearToken();
          }),
        10000
      );
    };
  } catch (error) {
    isAuthenticated.value = false;
    authError.value = error;
    throw new Error("Could not read access token");
  }
}

export async function updateToken() {
  if (!$keycloak) {
    throw new Error("Keycloak is not initialized.");
  }

  await $keycloak.updateToken(10);
  token.value = $keycloak.token;

  return $keycloak.token;
}

export const useKeycloak = () => {
  return {
    keycloak: $keycloak,
    isAuthenticated,
    token,
    authError,
    ready,
  };
};
