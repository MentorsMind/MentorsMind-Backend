export interface RegisterBody {
  name: string;
  email: string;
  password: string;
  role: 'mentor' | 'mentee';
}

export interface LoginBody {
  email: string;
  password: string;
}

export interface JwtPayload {
  userId: string;
  email: string;
  role: string;
}

export interface AuthResponse {
  user: {
    id: string;
    email: string;
    name: string;
    role: string;
    stellarPublicKey?: string;
    createdAt: string;
  };
  token: string;
  refreshToken: string;
}
