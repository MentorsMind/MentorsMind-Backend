import axios from "axios";
import { ServiceRegistry, __resetServiceRegistry } from "../service-registry";

jest.mock("axios");
const mockedAxios = axios as jest.Mocked<typeof axios>;

describe("ServiceRegistry", () => {
  afterEach(() => {
    __resetServiceRegistry();
    jest.clearAllMocks();
  });

  it("registers and matches services by path prefix", () => {
    const registry = new ServiceRegistry();
    registry.registerInstance({ service: "users", url: "http://users-1:4001" });
    registry.registerInstance({
      service: "users",
      url: "http://users-2:4001",
      weight: 2,
    });

    const svc = registry.matchServiceByPath("/users/42/profile");
    expect(svc?.name).toBe("users");
    expect(svc?.instances).toHaveLength(2);
  });

  it("prefers the most specific prefix", () => {
    const registry = new ServiceRegistry();
    registry.registerInstance({
      service: "billing",
      prefix: "/payments",
      url: "http://billing:5000",
    });
    registry.registerInstance({
      service: "billing-webhooks",
      prefix: "/payments/webhooks",
      url: "http://billing-hooks:5000",
    });

    expect(registry.matchServiceByPath("/payments/webhooks/stripe")?.name).toBe(
      "billing-webhooks",
    );
  });

  it("deregisters instances and drops empty dynamic services", () => {
    const registry = new ServiceRegistry();
    registry.registerInstance({ service: "search", url: "http://search-1:9200" });
    expect(registry.deregisterInstance("search", "http://search-1:9200")).toBe(
      true,
    );
    expect(registry.getService("search")).toBeUndefined();
  });

  it("marks an instance unhealthy after the failure threshold", async () => {
    mockedAxios.get.mockRejectedValue(new Error("ECONNREFUSED"));
    const registry = new ServiceRegistry();
    const svc = registry.registerInstance({
      service: "notif",
      url: "http://notif-1:7000",
    });
    const instance = svc.instances[0];

    for (let i = 0; i < 3; i += 1) {
      await registry.checkInstance(svc, instance);
    }
    expect(instance.health).toBe("unhealthy");
  });

  it("recovers an instance to healthy after enough successes", async () => {
    mockedAxios.get.mockResolvedValue({ status: 200, data: {} } as never);
    const registry = new ServiceRegistry();
    const svc = registry.registerInstance({
      service: "notif",
      url: "http://notif-1:7000",
    });
    const instance = svc.instances[0];

    await registry.checkInstance(svc, instance);
    await registry.checkInstance(svc, instance);
    expect(instance.health).toBe("healthy");
  });
});
