export interface RandomGenerator {
  random(): number;
}

export class RandGenXorshift implements RandomGenerator {
  private static BITS: bigint = 64n;
  private static MASK: bigint = (1n << RandGenXorshift.BITS) - 1n;
  private static MAX: number = Number(1n << RandGenXorshift.BITS);

  private state: bigint;

  // Seed is between 0 and 1.
  constructor(seed: number) {
    this.state = BigInt(RandGenXorshift.MAX * seed);
    if (this.state === 0n) {
      this.state = 1n;
    }
  }

  random(): number {
    this.state ^= this.state << 13n;
    this.state &= RandGenXorshift.MASK;
    this.state ^= this.state >> 7n;
    this.state ^= this.state << 17n;
    this.state &= RandGenXorshift.MASK;

    return Number(this.state) / RandGenXorshift.MAX;
  }
}
