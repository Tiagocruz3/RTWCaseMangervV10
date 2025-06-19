import React, { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { Upload, File, Download, Trash2, Eye, Loader } from 'lucide-react';
import { toast } from 'react-hot-toast';

interface Document {
  id: string;
  case_id: string;
  file_name: string;
  file_url: string;
  file_type: string;
  file_size: number;
  category: string;
  uploaded_by: string;
  created_at: string;
  storage_path?: string;
}

interface CaseDocumentsProps {
  caseId: string;
}

export const CaseDocuments: React.FC<CaseDocumentsProps> = ({ caseId }) => {
  const [documents, setDocuments] = useState<Document[]>([]);
  const [uploading, setUploading] = useState(false);
  const [loading, setLoading] = useState(true);
  const [selectedCategory, setSelectedCategory] = useState('medical');

  const categories = [
    { value: 'medical', label: 'Medical' },
    { value: 'legal', label: 'Legal' },
    { value: 'correspondence', label: 'Correspondence' },
    { value: 'other', label: 'Other' }
  ];

  useEffect(() => {
    if (caseId) {
      fetchDocuments();
    }
  }, [caseId]);

  const fetchDocuments = async () => {
    try {
      console.log('Fetching documents for case:', caseId);
      
      const { data, error } = await supabase
        .from('documents')
        .select('*')
        .eq('case_id', caseId)
        .order('created_at', { ascending: false });

      if (error) {
        console.error('Error fetching documents:', error);
        throw error;
      }
      
      console.log('Fetched documents:', data);
      setDocuments(data || []);
    } catch (error) {
      console.error('Error fetching documents:', error);
      toast.error('Failed to load documents');
    } finally {
      setLoading(false);
    }
  };

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    // Validate file size (10MB limit)
    const maxSize = 10 * 1024 * 1024; // 10MB in bytes
    if (file.size > maxSize) {
      toast.error('File size must be less than 10MB');
      return;
    }

    setUploading(true);
    toast.loading('Uploading document...', { id: 'upload' });

    try {
      // Get current user
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        throw new Error('No authenticated user');
      }

      console.log('Uploading file:', file.name, 'for user:', user.id);

      // Create unique file name
      const fileExt = file.name.split('.').pop();
      const fileName = `${caseId}/${Date.now()}-${Math.random().toString(36).substring(7)}.${fileExt}`;

      // Upload file to Supabase Storage
      const { data: uploadData, error: uploadError } = await supabase.storage
        .from('case-documents')
        .upload(fileName, file, {
          cacheControl: '3600',
          upsert: false
        });

      if (uploadError) {
        console.error('Upload error:', uploadError);
        throw uploadError;
      }

      console.log('File uploaded successfully:', uploadData);

      // Get public URL for the uploaded file
      const { data: { publicUrl } } = supabase.storage
        .from('case-documents')
        .getPublicUrl(fileName);

      console.log('Public URL:', publicUrl);

      // Save document metadata to database
      const documentData = {
        case_id: caseId,
        file_name: file.name,
        file_url: publicUrl,
        file_type: file.type || 'application/octet-stream',
        file_size: file.size,
        category: selectedCategory,
        uploaded_by: user.id,
        storage_path: fileName
      };

      console.log('Inserting document data:', documentData);

      const { data: docData, error: dbError } = await supabase
        .from('documents')
        .insert([documentData]) // Note: wrap in array
        .select();

      if (dbError) {
        console.error('Database insert error:', dbError);
        // If database insert fails, try to delete the uploaded file
        await supabase.storage.from('case-documents').remove([fileName]);
        throw dbError;
      }

      // Check if data was returned
      if (!docData || docData.length === 0) {
        console.error('No data returned from insert');
        throw new Error('Document insert failed - no data returned');
      }

      console.log('Document saved to database:', docData);

      // Update local state
      setDocuments([docData[0], ...documents]);
      toast.success('Document uploaded successfully', { id: 'upload' });
      
      // Reset file input
      event.target.value = '';
    } catch (error: any) {
      console.error('Upload error:', error);
      toast.error(error.message || 'Failed to upload document', { id: 'upload' });
    } finally {
      setUploading(false);
    }
  };

  const handleDelete = async (doc: Document) => {
    if (!confirm('Are you sure you want to delete this document?')) return;

    const toastId = toast.loading('Deleting document...');

    try {
      console.log('Deleting document:', doc);

      // Delete from database first
      const { error: dbError } = await supabase
        .from('documents')
        .delete()
        .eq('id', doc.id);

      if (dbError) {
        console.error('Database delete error:', dbError);
        throw dbError;
      }

      // Then delete from storage
      if (doc.storage_path) {
        const { error: storageError } = await supabase.storage
          .from('case-documents')
          .remove([doc.storage_path]);

        if (storageError) {
          console.error('Storage delete error:', storageError);
          // Don't throw here - document is already deleted from DB
        }
      } else {
        // Try to extract path from URL if storage_path is missing
        try {
          const urlParts = doc.file_url.split('/');
          const bucketIndex = urlParts.indexOf('case-documents');
          if (bucketIndex !== -1 && bucketIndex < urlParts.length - 1) {
            const pathParts = urlParts.slice(bucketIndex + 1);
            const storagePath = pathParts.join('/');
            
            await supabase.storage
              .from('case-documents')
              .remove([storagePath]);
          }
        } catch (e) {
          console.error('Could not extract storage path:', e);
        }
      }

      // Update local state
      setDocuments(documents.filter(d => d.id !== doc.id));
      toast.success('Document deleted successfully', { id: toastId });
    } catch (error: any) {
      console.error('Delete error:', error);
      toast.error(error.message || 'Failed to delete document', { id: toastId });
    }
  };

  const handleDownload = async (doc: Document) => {
    try {
      // For public buckets, just use the public URL
      window.open(doc.file_url, '_blank');
    } catch (error) {
      console.error('Download error:', error);
      toast.error('Failed to download document');
    }
  };

  const formatFileSize = (bytes: number) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  if (loading) {
    return (
      <div className="flex justify-center items-center p-8">
        <Loader className="animate-spin" size={24} />
        <span className="ml-2">Loading documents...</span>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Upload Section */}
      <div className="bg-white p-6 rounded-lg shadow">
        <h3 className="text-lg font-semibold mb-4">Upload Document</h3>
        
        <div className="flex items-center space-x-4">
          <select
            value={selectedCategory}
            onChange={(e) => setSelectedCategory(e.target.value)}
            className="px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            disabled={uploading}
          >
            {categories.map(cat => (
              <option key={cat.value} value={cat.value}>{cat.label}</option>
            ))}
          </select>

          <label className="relative">
            <input
              type="file"
              onChange={handleFileUpload}
              disabled={uploading}
              className="hidden"
              accept=".pdf,.doc,.docx,.jpg,.jpeg,.png,.txt"
            />
            <div className="flex items-center space-x-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer">
              {uploading ? (
                <Loader className="animate-spin" size={20} />
              ) : (
                <Upload size={20} />
              )}
              <span>{uploading ? 'Uploading...' : 'Choose File'}</span>
            </div>
          </label>
        </div>

        <p className="mt-2 text-sm text-gray-500">
          Supported formats: PDF, DOC, DOCX, JPG, PNG, TXT (Max 10MB)
        </p>
      </div>

      {/* Documents List */}
      <div className="bg-white rounded-lg shadow">
        <div className="px-6 py-4 border-b">
          <h3 className="text-lg font-semibold">Documents ({documents.length})</h3>
        </div>

        {documents.length === 0 ? (
          <div className="p-8 text-center text-gray-500">
            No documents uploaded yet
          </div>
        ) : (
          <div className="divide-y">
            {documents.map((doc) => (
              <div key={doc.id} className="px-6 py-4 hover:bg-gray-50">
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-3">
                    <File className="text-gray-400" size={20} />
                    <div>
                      <p className="font-medium">{doc.file_name}</p>
                      <p className="text-sm text-gray-500">
                        {doc.category} • {formatFileSize(doc.file_size)} • 
                        {new Date(doc.created_at).toLocaleDateString()}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center space-x-2">
                    <button
                      onClick={() => window.open(doc.file_url, '_blank')}
                      className="flex items-center space-x-1 px-3 py-1.5 text-sm text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                      title="View document"
                    >
                      <Eye size={16} />
                      <span>View</span>
                    </button>
                    <button
                      onClick={() => handleDownload(doc)}
                      className="flex items-center space-x-1 px-3 py-1.5 text-sm text-green-600 hover:bg-green-50 rounded-lg transition-colors"
                      title="Download document"
                    >
                      <Download size={16} />
                      <span>Download</span>
                    </button>
                    <button
                      onClick={() => handleDelete(doc)}
                      className="flex items-center space-x-1 px-3 py-1.5 text-sm text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                      title="Delete document"
                    >
                      <Trash2 size={16} />
                      <span>Delete</span>
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
