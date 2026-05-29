import pool from "../../config/database";
import { SearchService } from "../../services/search.service";
import { CacheService } from "../../services/cache.service";
import { buildSearchQuery } from "../../utils/query-builder.utils";

jest.mock("../../config/database");
jest.mock("../../services/cache.service");
jest.mock("../../utils/query-builder.utils");

const mockDb = pool as unknown as { query: jest.Mock };
const mockCache = CacheService as jest.Mocked<typeof CacheService>;
const mockBuildSearchQuery = buildSearchQuery as jest.MockedFunction<
  typeof buildSearchQuery
>;

type SearchFilters = Record<string, unknown> & {
  page?: number;
  limit?: number;
};

describe("SearchService.searchMentors", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("ejecuta búsqueda y cachea el resultado", async () => {
    mockCache.get.mockResolvedValue(null);
    mockBuildSearchQuery.mockReturnValue({
      query: "SELECT m.*, COUNT(*) OVER() as total_count FROM mentors m",
      values: [10, 0],
    });
    mockDb.query.mockResolvedValue({
      rows: [{ id: "m1", total_count: "3", name: "Mentor A" }],
      rowCount: 1,
      command: "SELECT",
      oid: 0,
      fields: [],
    });
    mockCache.set.mockResolvedValue(undefined);

    const filters: SearchFilters = { page: 1, limit: 10 };
    const result = await SearchService.searchMentors(filters);

    expect(result.meta.total).toBe(3);
    expect(result.meta.page).toBe(1);
    expect(result.mentors).toHaveLength(1);
    expect(mockCache.set).toHaveBeenCalled();
  });

  it("devuelve resultado desde cache sin consultar DB", async () => {
    const cached = {
      mentors: [{ id: "cached" }],
      meta: { total: 1, page: 1, limit: 10 },
    };
    mockCache.get.mockResolvedValue(cached);

    const result = await SearchService.searchMentors({ page: 1, limit: 10 });

    expect(result).toEqual(cached);
    expect(mockDb.query).not.toHaveBeenCalled();
  });

  it("trata búsqueda sin resultados como respuesta válida", async () => {
    mockCache.get.mockResolvedValue(null);
    mockBuildSearchQuery.mockReturnValue({ query: "SELECT ...", values: [] });
    mockDb.query.mockResolvedValue({
      rows: [],
      rowCount: 0,
      command: "SELECT",
      oid: 0,
      fields: [],
    });
    mockCache.set.mockResolvedValue(undefined);

    const result = await SearchService.searchMentors({ page: 1, limit: 10 });

    expect(result.mentors).toEqual([]);
    expect(result.meta.total).toBe(0);
  });

  it("propaga error si falla la consulta a base de datos", async () => {
    mockCache.get.mockResolvedValue(null);
    mockBuildSearchQuery.mockReturnValue({ query: "SELECT ...", values: [] });
    mockDb.query.mockRejectedValue(new Error("db unavailable"));

    await expect(
      SearchService.searchMentors({ page: 1, limit: 10 }),
    ).rejects.toThrow("db unavailable");
  });
});
