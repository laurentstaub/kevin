// Document model for handling document operations
class Document {
    // Get all documents for a specific product by CIS code
    static async getDocumentsByProductId(pool, cisCode) {
        const query = `
            SELECT 
                code_cis,
                document_type,
                html_content,
                file_path,
                last_updated
            FROM dbpm.cis_documents 
            WHERE code_cis = $1
            ORDER BY document_type, last_updated DESC
        `;
        
        try {
            const result = await pool.query(query, [cisCode]);
            return result.rows;
        } catch (error) {
            console.error('Error fetching documents:', error);
            throw error;
        }
    }
    
    // Get document type label in French
    static getDocumentTypeLabel(type) {
        const labels = {
            'rcp': 'Résumé des Caractéristiques du Produit',
            'notice': 'Notice Patient', 
            'main': 'Document Principal'
        };
        return labels[type] || type;
    }
    
    // Check if document is PDF based on URL or type
    static isPdfDocument(url) {
        if (!url) return false;
        return url.toLowerCase().includes('.pdf') || url.toLowerCase().includes('pdf');
    }
    
    // Organize documents by type
    static organizeDocumentsByType(documents) {
        return {
            rcp: documents.filter(doc => doc.document_type === 'rcp'),
            notice: documents.filter(doc => doc.document_type === 'notice'),
            main: documents.filter(doc => doc.document_type === 'main')
        };
    }
}

export default Document;