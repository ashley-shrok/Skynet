import { useEffect, useState, useCallback } from "react";
import { isElectron } from "@/lib/electron";
import { getBasePath } from "@/lib/base-path";

interface ServiceWorkerState {
  isSupported: boolean;
  isRegistered: boolean;
  updateAvailable: boolean;
}

export function useServiceWorker(): ServiceWorkerState {
  const [state, setState] = useState<ServiceWorkerState>({
    isSupported: false,
    isRegistered: false,
    updateAvailable: false,
  });

  const handleUpdateFound = useCallback(
    (registration: ServiceWorkerRegistration) => {
      const newWorker = registration.installing;
      if (!newWorker) return;

      // Track previous state for structured statechange logging (D-06/D-15)
      let prevState: string | null = newWorker.state ?? null;

      newWorker.addEventListener("statechange", () => {
        console.info(
          `[pwa] sw-statechange oldState=${prevState ?? "null"} newState=${newWorker.state}`,
        );
        prevState = newWorker.state;
        if (
          newWorker.state === "installed" &&
          navigator.serviceWorker.controller
        ) {
          setState((prev) => ({ ...prev, updateAvailable: true }));
        }
      });
    },
    [],
  );

  useEffect(() => {
    const isSupported =
      "serviceWorker" in navigator && !isElectron() && import.meta.env.PROD;

    setState((prev) => ({ ...prev, isSupported }));

    if (!isSupported) return;

    const shouldReloadOnControllerChange = Boolean(
      navigator.serviceWorker.controller,
    );
    let hasReloadedForUpdate = false;
    const handleControllerChange = () => {
      console.info(
        `[pwa] sw-controller-change shouldReload=${shouldReloadOnControllerChange}`,
      );
      if (!shouldReloadOnControllerChange || hasReloadedForUpdate) {
        return;
      }

      hasReloadedForUpdate = true;
      window.location.reload();
    };

    const registerSW = async () => {
      try {
        const registration = await navigator.serviceWorker.register(
          `${getBasePath()}/sw.js`,
          { updateViaCache: "none" },
        );
        setState((prev) => ({ ...prev, isRegistered: true }));

        registration.addEventListener("updatefound", () => {
          console.info(`[pwa] sw-update-found`);
          handleUpdateFound(registration);
        });
        await registration.update();
      } catch (error) {
        console.error(
          `[pwa] sw-register-failed err="${error instanceof Error ? error.message : String(error)}"`,
        );
      }
    };

    navigator.serviceWorker.addEventListener(
      "controllerchange",
      handleControllerChange,
    );

    if (document.readyState === "complete") {
      registerSW();
    } else {
      window.addEventListener("load", registerSW);
    }

    return () => {
      window.removeEventListener("load", registerSW);
      navigator.serviceWorker.removeEventListener(
        "controllerchange",
        handleControllerChange,
      );
    };
  }, [handleUpdateFound]);

  return state;
}
