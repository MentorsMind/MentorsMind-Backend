/**
 * @deprecated Import from `./database` instead. Kept for backward compatibility.
 */
import pool, { poolConfig, createOptimizedPool } from "./database";

export { poolConfig, createOptimizedPool };
export const optimizedPool = pool;
export default pool;
