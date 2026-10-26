import copy, gzip, importlib.util, json, unittest
from pathlib import Path
ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('animated_assets', ROOT/'android-native/scripts/prepare-animated-emojis.py')
module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module)
def gradients(node):
    result = []
    if isinstance(node, dict):
        if node.get('ty') in ('gf', 'gs') and 'g' in node:
            p = node['g']['p']; k = node['g']['k']['k']
            arrays = [k] if k and isinstance(k[0], (int,float)) else [f[key] for f in k for key in ('s','e') if key in f]
            result.extend((p, a) for a in arrays)
        for value in node.values(): result.extend(gradients(value))
    elif isinstance(node, list):
        for value in node: result.extend(gradients(value))
    return result
def opacity(tail, x):
    if not tail: return 1
    pairs = list(zip(tail[::2],tail[1::2]))
    if x <= pairs[0][0]: return pairs[0][1]
    for (a,aa),(b,ba) in zip(pairs,pairs[1:]):
        if x <= b: return aa+(ba-aa)*(x-a)/(b-a)
    return pairs[-1][1]
class GradientCompatibilityTest(unittest.TestCase):
    def test_bronze_keeps_colors_and_opacity_and_is_idempotent(self):
        original=json.loads(gzip.decompress((ROOT/'client/public/site/animated-emoji/tg_emoji_483.tgs').read_bytes()))
        adapted=copy.deepcopy(original); self.assertGreater(module.close_opacity_endpoints(adapted),0)
        self.assertEqual(module.close_opacity_endpoints(adapted),0)
        for (p,before),(q,after) in zip(gradients(original),gradients(adapted)):
            self.assertEqual(p,q); self.assertEqual(before[:p*4],after[:p*4])
            for i in range(101): self.assertAlmostEqual(opacity(before[p*4:],i/100),opacity(after[q*4:],i/100),places=10)
        self.assertEqual(original['fr'],adapted['fr']);self.assertEqual(original['op'],adapted['op'])
if __name__=='__main__': unittest.main()
