export async function highestQualityImageWithinBudget<
  T extends { size: number },
>(input: {
  qualities: readonly number[]
  maxByteSize: number
  encode: (quality: number) => Promise<T | null>
}) {
  for (const quality of input.qualities) {
    const encoded = await input.encode(quality)

    if (!encoded) {
      return null
    }

    if (encoded.size <= input.maxByteSize) {
      return encoded
    }
  }

  return null
}
