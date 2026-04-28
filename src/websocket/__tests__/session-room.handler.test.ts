import { handleSessionRoomMessage } from "../ws-handlers/session-room.handler";
import { SessionModel } from "../../models/session.model";
import { AuthenticatedWebSocket } from "../ws-auth.middleware";

jest.mock("../../models/session.model", () => ({
  SessionModel: {
    findById: jest.fn(),
  },
}));

jest.mock("../../utils/logger.utils", () => ({
  logger: {
    info: jest.fn(),
    error: jest.fn(),
  },
}));

describe("session-room.handler", () => {
  let mentorClient: any;
  let menteeClient: any;
  let unauthorizedClient: any;

  const mockSessionId = "test-session-id";

  beforeEach(() => {
    jest.clearAllMocks();

    mentorClient = {
      userId: "mentor-1",
      role: "mentor",
      readyState: 1, // WebSocket.OPEN
      send: jest.fn(),
    };

    menteeClient = {
      userId: "mentee-1",
      role: "mentee",
      readyState: 1, // WebSocket.OPEN
      send: jest.fn(),
    };

    unauthorizedClient = {
      userId: "hacker-1",
      role: "mentor", // even if they are a mentor, they aren't in this session
      readyState: 1,
      send: jest.fn(),
    };

    (SessionModel.findById as jest.Mock).mockResolvedValue({
      id: mockSessionId,
      mentor_id: "mentor-1",
      mentee_id: "mentee-1",
    });
  });

  it("prevents non-participants from starting a session", async () => {
    // First, let the mentor join the room so it exists
    await handleSessionRoomMessage(mentorClient, {
      event: "session:join",
      data: { sessionId: mockSessionId },
    });

    await handleSessionRoomMessage(unauthorizedClient, {
      event: "session:start",
      data: { sessionId: mockSessionId },
    });

    expect(unauthorizedClient.send).toHaveBeenCalledWith(
      JSON.stringify({
        event: "session:error",
        data: { message: "Not a participant of this session" },
      }),
    );
  });

  it("prevents non-mentors from starting a session", async () => {
    // Both join the room
    await handleSessionRoomMessage(mentorClient, {
      event: "session:join",
      data: { sessionId: mockSessionId },
    });
    await handleSessionRoomMessage(menteeClient, {
      event: "session:join",
      data: { sessionId: mockSessionId },
    });

    // Mentee tries to start
    await handleSessionRoomMessage(menteeClient, {
      event: "session:start",
      data: { sessionId: mockSessionId },
    });

    expect(menteeClient.send).toHaveBeenCalledWith(
      JSON.stringify({
        event: "session:error",
        data: { message: "Only the mentor can start/end a session" },
      }),
    );
  });

  it("allows the mentor to start a session", async () => {
    await handleSessionRoomMessage(mentorClient, {
      event: "session:join",
      data: { sessionId: mockSessionId },
    });

    await handleSessionRoomMessage(menteeClient, {
      event: "session:join",
      data: { sessionId: mockSessionId },
    });

    await handleSessionRoomMessage(mentorClient, {
      event: "session:start",
      data: { sessionId: mockSessionId },
    });

    // Mentee should receive the broadcast
    expect(menteeClient.send).toHaveBeenCalledWith(
      expect.stringContaining('"event":"session:started"'),
    );
  });

  it("prevents non-mentors from ending a session", async () => {
    await handleSessionRoomMessage(mentorClient, {
      event: "session:join",
      data: { sessionId: mockSessionId },
    });
    await handleSessionRoomMessage(menteeClient, {
      event: "session:join",
      data: { sessionId: mockSessionId },
    });

    await handleSessionRoomMessage(menteeClient, {
      event: "session:end",
      data: { sessionId: mockSessionId },
    });

    expect(menteeClient.send).toHaveBeenCalledWith(
      JSON.stringify({
        event: "session:error",
        data: { message: "Only the mentor can start/end a session" },
      }),
    );
  });
});
