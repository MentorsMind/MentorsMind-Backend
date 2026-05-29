/**
 * Holds references to started testcontainer stop functions so that
 * globalSetup and globalTeardown can share them within the same Jest process.
 */
interface ContainerRegistry {
  stopPg?: () => Promise<void>;
  stopRedis?: () => Promise<void>;
}

// Node.js module cache keeps this instance alive across globalSetup → globalTeardown
const registry: ContainerRegistry = {};

export default registry;
