
export interface User {
  id: string;
  name: string;
  email: string;
  role: string;
  avatar: string;
  title: string;
}

export interface Gig {
  id: string;
  freelancerId: string;
  title: string;
  price: number;
}

export interface Workstream {
  id: string;
  title: string;
  buyerId: string;
  sellerId: string;
  gigId?: string;
  status: string;
}

// Mock Data Storage (in-memory for now)
let users: User[] = [];
let gigs: Gig[] = [];
let workstreams: Workstream[] = [];

export function setInitialData(u: User[], g: Gig[], w: Workstream[]) {
  users = u;
  gigs = g;
  workstreams = w;
}

export function getWorkstreamDetails(workstreamId: string) {
  const workstream = workstreams.find(w => w.id === workstreamId);
  if (!workstream) return null;

  const buyer = users.find(u => u.id === workstream.buyerId);
  const seller = users.find(u => u.id === workstream.sellerId);
  const gig = workstream.gigId ? gigs.find(g => g.id === workstream.gigId) : null;

  return {
    ...workstream,
    buyer,
    seller,
    gig
  };
}
