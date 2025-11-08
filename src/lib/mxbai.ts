import Mixedbread from "@mixedbread/sdk";
import { isDevelopment } from "../utils";

const BASE_URL = isDevelopment()
  ? "http://localhost:8000"
  : "https://www.platform.mixedbread.com";

export function createMxbaiClient(authToken: string) {
  if (!authToken) {
    throw new Error("Token is required");
  }

  return new Mixedbread({
    baseURL: BASE_URL,
    apiKey: authToken,
  });
}
