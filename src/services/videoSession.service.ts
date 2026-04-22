import axios from "axios";
import { v4 as uuidv4 } from "uuid";
import env from "../config/env";

class VideoSessionService {
  private provider = "daily"; // or switch via env

  async createRoom(booking: any) {
    const roomName = `booking-${booking.id}-${uuidv4()}`;

    if (this.provider === "daily") {
      const response = await axios.post(
        "https://api.daily.co/v1/rooms",
        {
          name: roomName,
          properties: {
            exp: this.getExpiry(booking),
          },
        },
        {
          headers: {
            Authorization: `Bearer ${env.DAILY_API_KEY}`,
          },
        }
      );

      return response.data;
    }

    throw new Error("Unsupported provider");
  }

  async generateToken(roomName: string, role: "mentor" | "mentee") {
    if (this.provider === "daily") {
      const response = await axios.post(
        "https://api.daily.co/v1/meeting-tokens",
        {
          properties: {
            room_name: roomName,
            is_owner: role === "mentor",
          },
        },
        {
          headers: {
            Authorization: `Bearer ${env.DAILY_API_KEY}`,
          },
        }
      );

      return response.data.token;
    }

    throw new Error("Unsupported provider");
  }

  private getExpiry(booking: any) {
    const endTime = new Date(booking.end_time);
    return Math.floor((endTime.getTime() + 60 * 60 * 1000) / 1000); // +1hr
  }
}

export default new VideoSessionService();
