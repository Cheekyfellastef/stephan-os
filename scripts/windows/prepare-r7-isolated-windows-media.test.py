import importlib.util,io,pathlib,struct,tempfile,unittest
source=pathlib.Path(__file__).with_name('prepare-r7-isolated-windows-media.py')
spec=importlib.util.spec_from_file_location('media',source);media=importlib.util.module_from_spec(spec);spec.loader.exec_module(media)

def wim(xml=None):
    if xml is None:
        xml='<WIM>'+''.join('<IMAGE INDEX="'+str(i)+'"><WINDOWS><EDITIONID>ServerStandardEval</EDITIONID><INSTALLATIONTYPE>Server Core</INSTALLATIONTYPE><ARCH>9</ARCH><VERSION><MAJOR>10</MAJOR><MINOR>0</MINOR><BUILD>20348</BUILD><SPBUILD>587</SPBUILD></VERSION><LANGUAGES><LANGUAGE>en-US</LANGUAGE></LANGUAGES></WINDOWS></IMAGE>' for i in range(1,5))+'</WIM>'
    data=xml.encode('utf-16');header=bytearray(208);header[:8]=b'MSWIM\0\0\0';struct.pack_into('<I',header,8,208);struct.pack_into('<HHI',header,40,1,1,4);header[72:79]=len(data).to_bytes(7,'little');struct.pack_into('<QQ',header,80,208,len(data));return bytes(header)+data

class MediaTests(unittest.TestCase):
    def test_selected_image(self):
        data=wim();self.assertEqual(media.read_wim_metadata(io.BytesIO(data),len(data)),data[208:])
    def test_external_declaration_rejected(self):
        data=wim('<!DOCTYPE WIM [<!ENTITY a "x">]><WIM/>')
        with self.assertRaisesRegex(ValueError,'DECLARATION'):media.read_wim_metadata(io.BytesIO(data),len(data))
    def test_unknown_compression_rejected(self):
        data=bytearray(wim());data[79]=4
        with self.assertRaisesRegex(ValueError,'RESOURCE'):media.read_wim_metadata(io.BytesIO(data),len(data))
    def test_outside_resource_rejected(self):
        data=bytearray(wim());struct.pack_into('<Q',data,80,len(data)-1)
        with self.assertRaisesRegex(ValueError,'RESOURCE'):media.read_wim_metadata(io.BytesIO(data),len(data))
    def test_wrong_selected_version_rejected(self):
        data=wim().replace('20348'.encode('utf-16-le'),'20349'.encode('utf-16-le'))
        with self.assertRaisesRegex(ValueError,'IDENTITY'):media.read_wim_metadata(io.BytesIO(data),len(data))
    def test_duplicate_index_rejected(self):
        data=wim().replace('INDEX="2"'.encode('utf-16-le'),'INDEX="1"'.encode('utf-16-le'))
        with self.assertRaisesRegex(ValueError,'AMBIGUOUS'):media.read_wim_metadata(io.BytesIO(data),len(data))
    def test_partial_header(self):
        with self.assertRaisesRegex(ValueError,'HEADER'):media.read_wim_metadata(io.BytesIO(b'MSWIM'),5)
    def test_stream_bounded_exact(self):
        with tempfile.TemporaryDirectory() as directory:
            target=pathlib.Path(directory)/'fixed';self.assertEqual(media.copy_bounded(io.BytesIO(b'abc'),target,3),'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');self.assertEqual(target.read_bytes(),b'abc')
    def test_existing_output_preserved(self):
        with tempfile.TemporaryDirectory() as directory:
            target=pathlib.Path(directory)/'fixed';target.write_bytes(b'original')
            with self.assertRaises(FileExistsError):media.copy_bounded(io.BytesIO(b'abc'),target,3)
            self.assertEqual(target.read_bytes(),b'original')
    def test_short_stream_refused(self):
        with tempfile.TemporaryDirectory() as directory:
            with self.assertRaisesRegex(ValueError,'TRUNCATED'):media.copy_bounded(io.BytesIO(b'ab'),pathlib.Path(directory)/'fixed',3)
    def test_excess_stream_refused(self):
        with tempfile.TemporaryDirectory() as directory:
            with self.assertRaisesRegex(ValueError,'EXCEEDED'):media.copy_bounded(io.BytesIO(b'abcd'),pathlib.Path(directory)/'fixed',3)
    def test_wrong_media_rejected_before_output(self):
        with tempfile.TemporaryDirectory() as directory:
            root=pathlib.Path(directory);(root/'iso').write_bytes(b'x');(root/'wheel').write_bytes(b'x')
            with self.assertRaisesRegex(ValueError,'HASH'):media.main([str(root/'iso'),str(root/'wheel'),str(root/'new')])
            self.assertFalse((root/'new').exists())
if __name__=='__main__':unittest.main()
